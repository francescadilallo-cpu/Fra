from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Any, Callable, Literal

from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

# Upper bound on the retained audit ring buffer. The durable audit trail is
# emitted to the application logs (AGENT_AUDIT json lines); the store-backed
# copy only serves the get_audit_log() read API, so a bounded ring buffer is
# enough and prevents unbounded growth on long-running instances.
_MAX_AUDIT_RECORDS = 2000


class AgentSemanticValidationError(Exception):
    """Raised when an executive action violates ontology or business constraints."""


class AgentActionNotFoundError(Exception):
    """Raised when an action_id does not exist in pending queue."""


class AgentExecutionError(Exception):
    """Raised when approved action execution fails."""


AgentStatus = Literal[
    "PENDING_HUMAN_APPROVAL",
    "PROCESSING",  # claimed by a worker; decision is being applied
    "VALIDATION_FAILED",
    "REJECTED",
    "EXECUTED",
    "SYNCED",
    "SYNC_FAILED",
    "FAILED",
]


class ActionEffect(BaseModel):
    action_type: str
    affected_tables: list[str] = Field(default_factory=list)
    affected_node_ids: list[str] = Field(default_factory=list)
    changed_fields: dict[str, Any] = Field(default_factory=dict)
    entity_types: list[str] = Field(default_factory=list)


class ResyncResult(BaseModel):
    nodes_patched: int = 0
    cache_keys_invalidated: int = 0
    duration_ms: float = 0.0
    errors: list[str] = Field(default_factory=list)
    completed_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


OrderStatus = Literal["shipped", "cancelled", "delivered", "processing"]

_STATUS_MAP: dict[str, str] = {
    # Italian
    "spedito": "shipped",
    "consegnato": "delivered",
    "in lavorazione": "processing",
    "in elaborazione": "processing",
    # English
    "shipped": "shipped",
    "delivered": "delivered",
    "processing": "processing",
    "in processing": "processing",
}
# Keep old name as alias for any references still using it
_STATUS_IT_MAP = _STATUS_MAP

_VALID_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "processing": {"shipped", "cancelled"},
    "shipped": {"delivered"},
    "delivered": set(),
    "cancelled": set(),
}


# Actions that write to business data (demo ERP orders).
_ORDER_ACTIONS = {"UPDATE_ORDER_DELIVERY_DATE", "UPDATE_ORDER_STATUS"}
# Actions that curate the data model itself — no source-system writes.
_DATA_MODEL_ACTIONS = {"MERGE_ENTITIES", "RENAME_ENTITY", "SET_ENTITY_CONCEPT"}
# Actions that write back to an EXTERNAL source system (Salesforce).
_SALESFORCE_ACTIONS = {"UPDATE_SALESFORCE_FIELD"}
# System/audit fields that must never be writable, whatever describe says.
_SF_BLOCKED_FIELDS = frozenset(
    {
        "id",
        "createddate",
        "createdbyid",
        "lastmodifieddate",
        "lastmodifiedbyid",
        "systemmodstamp",
        "isdeleted",
    }
)


class ProposedWriteAction(BaseModel):
    action_type: Literal[
        "UPDATE_ORDER_DELIVERY_DATE",
        "UPDATE_ORDER_STATUS",
        "MERGE_ENTITIES",
        "RENAME_ENTITY",
        "SET_ENTITY_CONCEPT",
        "UPDATE_SALESFORCE_FIELD",
    ]
    # Order write-back fields
    order_id: int | None = None
    new_delivery_date: date | None = None
    new_status: str | None = None
    # Data-model curation fields
    entity: str | None = None
    entity_b: str | None = None
    new_name: str | None = None
    concept: str | None = None
    # Salesforce write-back fields (single-field record update)
    sf_object: str | None = None
    sf_record_id: str | None = None
    sf_field: str | None = None
    sf_value: str | None = None
    rationale: str


class AgentAuditRecord(BaseModel):
    record_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    action_id: str | None = None
    phase: Literal[
        "PROPOSED",
        "VALIDATED",
        "QUEUED",
        "APPROVED",
        "REJECTED",
        "EXECUTED",
        "RESYNCED",
        "FAILED",
    ]
    actor: str
    actor_role: str
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    details: dict[str, Any] = Field(default_factory=dict)


class PendingAgentAction(BaseModel):
    action_id: str
    status: AgentStatus
    command: str
    requested_by: str
    requested_role: str
    proposed_action: ProposedWriteAction
    validation_checks: list[str] = Field(default_factory=list)
    manager_note: str | None = None
    resync_result: ResyncResult | None = None
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class ValidationOutcome(BaseModel):
    passed: bool
    checks: list[str] = Field(default_factory=list)
    reason: str | None = None


class ExecutiveAgenticLayer:
    """Agentic control loop with strict validation and human approval gate."""

    def __init__(
        self,
        get_ontology: Callable[[], Any],
        get_db_connection: Callable[[], Any],
        kg_patcher: Callable[["ActionEffect"], int] | None = None,
        cache_invalidator: Callable[[], int] | None = None,
        state_db_path: "Path | None" = None,
        get_catalog: Callable[[], Any] | None = None,
        sf_check: Callable[[str, str, str], str | None] | None = None,
        sf_update: Callable[[str, str, str, str], None] | None = None,
    ) -> None:
        # Local import avoids a module-level circular import (store imports the
        # action/audit models from this module).
        from .store import AgentStateStore

        self._get_ontology = get_ontology
        self._get_db_connection = get_db_connection
        self._kg_patcher = kg_patcher
        self._cache_invalidator = cache_invalidator
        self._get_catalog = get_catalog
        # Salesforce write-back gateway, injected by main. ``sf_check(object,
        # field, record_id)`` returns an error string or None; ``sf_update``
        # performs the single-field PATCH. Absent → the action type is
        # rejected at validation ("not configured"), never at execution.
        self._sf_check = sf_check
        self._sf_update = sf_update
        # Guards the approve/reject critical section within a single process.
        # Cross-process atomicity is best-effort via a status re-check against
        # the shared store.
        self._lock = threading.RLock()
        # Single source of truth for pending actions + audit. File-backed in
        # production (survives restart, shared across workers); in-memory and
        # isolated per instance when no path is given (default / tests).
        self._store = AgentStateStore(state_db_path, max_audit=_MAX_AUDIT_RECORDS)

    def submit_command(
        self, command: str, actor: str, actor_role: str
    ) -> PendingAgentAction:
        command_norm = command.strip()
        if not command_norm:
            raise AgentSemanticValidationError("Command cannot be empty")

        proposal = self._parse_command(command_norm)
        self._audit(
            phase="PROPOSED",
            actor=actor,
            actor_role=actor_role,
            details={
                "command": command_norm,
                "proposed_action": proposal.model_dump(mode="json"),
            },
        )

        validation = self._validate_semantics(proposal)
        if not validation.passed:
            self._audit(
                phase="FAILED",
                actor=actor,
                actor_role=actor_role,
                details={"reason": validation.reason, "checks": validation.checks},
            )
            raise AgentSemanticValidationError(
                validation.reason or "Action rejected — check syntax or business rules"
            )

        action_id = str(uuid.uuid4())
        action = PendingAgentAction(
            action_id=action_id,
            status="PENDING_HUMAN_APPROVAL",
            command=command_norm,
            requested_by=actor,
            requested_role=actor_role,
            proposed_action=proposal,
            validation_checks=validation.checks,
        )

        self._store.save_action(action)

        self._audit(
            phase="VALIDATED",
            action_id=action_id,
            actor=actor,
            actor_role=actor_role,
            details={"checks": validation.checks},
        )
        self._audit(
            phase="QUEUED",
            action_id=action_id,
            actor=actor,
            actor_role=actor_role,
            details={"status": action.status},
        )
        return action

    def approve_action(
        self,
        action_id: str,
        actor: str,
        actor_role: str,
        approve: bool,
        manager_note: str | None,
    ) -> PendingAgentAction:
        now = datetime.now(UTC).isoformat()
        with self._lock:
            # Atomically claim the action before doing any work.
            #
            # Two workers racing the same approve request (e.g. a manager
            # double-clicking, hitting different processes behind a load
            # balancer — see AgentStateStore's "shared across worker processes"
            # design goal) must not both read PENDING_HUMAN_APPROVAL, both
            # execute the DB writeback, and both append duplicate
            # EXECUTED/RESYNCED audit entries for what must be a single,
            # irreversible state transition. The in-process RLock above still
            # serialises same-process callers cheaply; the real cross-process
            # guarantee comes from claim_pending_action()'s
            # UPDATE...WHERE status='PENDING_HUMAN_APPROVAL' — SQLite
            # serialises writers at the file/WAL level, so only the first
            # caller to reach that statement "wins" (rowcount == 1); everyone
            # else gets None back and must not proceed.
            action = self._store.claim_pending_action(action_id, "PROCESSING", now)
            if action is None:
                existing = self._store.get_action(action_id)
                if existing is None:
                    raise AgentActionNotFoundError(f"Action '{action_id}' not found")
                raise AgentExecutionError(
                    f"Action '{action_id}' is in status '{existing.status}' "
                    "and cannot be approved"
                )

            action.manager_note = manager_note
            action.updated_at = now

            if not approve:
                action.status = "REJECTED"
                self._store.save_action(action)
                self._audit(
                    phase="REJECTED",
                    action_id=action_id,
                    actor=actor,
                    actor_role=actor_role,
                    details={"manager_note": manager_note or ""},
                )
                # Learning loop: a rejected merge goes on the advisor's
                # deny-list so it is never re-proposed. Best-effort.
                if action.proposed_action.action_type == "MERGE_ENTITIES":
                    try:
                        from app.curation.learning import (  # noqa: PLC0415
                            record_rejected_merge,
                        )

                        record_rejected_merge(
                            action.proposed_action,
                            self._get_catalog() if self._get_catalog else None,
                            note=manager_note or "",
                        )
                    except Exception:  # noqa: BLE001 — never fail the reject
                        logger.debug("rejection learning hook failed", exc_info=True)
                return action

            self._audit(
                phase="APPROVED",
                action_id=action_id,
                actor=actor,
                actor_role=actor_role,
                details={"manager_note": manager_note or ""},
            )

            try:
                # _validate_semantics ran at *submission* time, but approval is
                # an asynchronous, human-gated step that can happen long after
                # — the order may have moved on (via this or another action, or
                # a direct write) by the time a manager acts on a now-stale
                # proposal. Blindly replaying it could silently regress a
                # terminal state (e.g. "delivered" -> "shipped") or resurrect a
                # deleted order. Re-check against *current* state right before
                # writing anything, closing the gap to milliseconds.
                revalidation = self._validate_semantics(action.proposed_action)
                if not revalidation.passed:
                    raise AgentSemanticValidationError(
                        "Re-validation failed: state has changed since the original "
                        f"proposal — {revalidation.reason}"
                    )

                self._execute_writeback(action.proposed_action)
                action.status = "EXECUTED"
                action.updated_at = datetime.now(UTC).isoformat()
                self._store.save_action(action)
                self._audit(
                    phase="EXECUTED",
                    action_id=action_id,
                    actor=actor,
                    actor_role=actor_role,
                    details={"action": action.proposed_action.model_dump(mode="json")},
                )

                effect = self._compute_action_effect(action.proposed_action)
                resync = self._propagate_changes(effect)
                action.resync_result = resync
                action.status = "SYNC_FAILED" if resync.errors else "SYNCED"
                action.updated_at = datetime.now(UTC).isoformat()
                self._store.save_action(action)
                self._audit(
                    phase="RESYNCED",
                    action_id=action_id,
                    actor=actor,
                    actor_role=actor_role,
                    details={
                        "nodes_patched": resync.nodes_patched,
                        "cache_keys_invalidated": resync.cache_keys_invalidated,
                        "duration_ms": resync.duration_ms,
                        "errors": resync.errors,
                    },
                )
                return action
            except Exception as exc:
                action.status = "FAILED"
                action.updated_at = datetime.now(UTC).isoformat()
                self._store.save_action(action)
                self._audit(
                    phase="FAILED",
                    action_id=action_id,
                    actor=actor,
                    actor_role=actor_role,
                    details={"error": str(exc)},
                )
                # Only pass through messages from controlled exceptions (we
                # author those texts); raw system errors (DB, IO, HTTP) must
                # not leak internal details.
                _safe_msg = (
                    str(exc)
                    if isinstance(
                        exc,
                        (ValueError, AgentSemanticValidationError, AgentExecutionError),
                    )
                    else "Action execution failed — see audit log for details"
                )
                raise AgentExecutionError(_safe_msg) from exc

    def get_action(self, action_id: str) -> PendingAgentAction | None:
        """Return a single action by id, or None if unknown."""
        return self._store.get_action(action_id)

    def get_audit_log(self, limit: int = 200) -> list[AgentAuditRecord]:
        return self._store.get_audit(limit)

    def list_actions(
        self,
        status_filter: str | None = None,
        limit: int = 50,
    ) -> list[PendingAgentAction]:
        return self._store.list_actions(status_filter=status_filter, limit=limit)

    def _parse_command(self, command: str) -> ProposedWriteAction:
        import re

        # Italian patterns kept for backward compatibility
        delivery_re = re.compile(
            r"sposta\s+la\s+data\s+di\s+consegna\s+dell[' ]ordine\s+(\d+)\s+(?:al|alla|a)\s+(\d{4}-\d{2}-\d{2})",
            re.IGNORECASE,
        )
        status_re = re.compile(
            r"(?:segna|marca)\s+l[' ]ordine\s+(\d+)\s+come\s+(spedito|consegnato|in\s+lavorazione|in\s+elaborazione)",
            re.IGNORECASE,
        )
        cancel_re = re.compile(
            r"(?:cancella|annulla)\s+l[' ]ordine\s+(\d+)",
            re.IGNORECASE,
        )
        # English patterns
        delivery_en_re = re.compile(
            r"(?:update|change|set)\s+(?:the\s+)?delivery\s+date\s+(?:of\s+)?(?:order\s+)?(\d+)\s+to\s+(\d{4}-\d{2}-\d{2})",
            re.IGNORECASE,
        )
        status_en_re = re.compile(
            r"(?:mark|set)\s+order\s+(\d+)\s+as\s+(shipped|delivered|processing|in\s+processing)",
            re.IGNORECASE,
        )
        cancel_en_re = re.compile(
            r"(?:cancel)\s+order\s+(\d+)",
            re.IGNORECASE,
        )

        # ── Data-model curation commands (no source-system writes) ────────────
        # Merge: "unisci le entità X e Y" / "merge entities X and Y"
        merge_re = re.compile(
            r"(?:unisci\s+le\s+entit[àa]|merge\s+entit(?:ies|y))\s+([\w.]+)\s+(?:e|and|with|con)\s+([\w.]+)",
            re.IGNORECASE,
        )
        # Rename: "rinomina l'entità X in Y" / "rename entity X to Y"
        rename_re = re.compile(
            r"(?:rinomina\s+l[' ]entit[àa]|rename\s+entity)\s+([\w.]+)\s+(?:in|to|as)\s+(.+?)\s*$",
            re.IGNORECASE,
        )
        # Concept: "assegna l'entità X al concetto Y" /
        #          "assign entity X to concept Y" / "set entity X concept to Y"
        concept_re = re.compile(
            r"(?:assegna\s+l[' ]entit[àa]\s+([\w.]+)\s+al\s+concetto\s+([\w]+)"
            r"|(?:assign|set)\s+entity\s+([\w.]+)\s+(?:to\s+concept|concept\s+to)\s+([\w]+))",
            re.IGNORECASE,
        )

        # ── Salesforce write-back: single-field record update ────────────────
        # EN: update salesforce <Object> <RecordId> set <field> to <value>
        # IT: aggiorna su salesforce <Object> <RecordId> campo <field> a <value>
        sf_update_re = re.compile(
            r"(?:update\s+salesforce|aggiorna\s+(?:su\s+)?salesforce)\s+"
            r"(\w+)\s+([a-zA-Z0-9]{15,18})\s+"
            r"(?:set\s+|campo\s+)?([\w]+)\s+(?:to|a)\s+(.+?)\s*$",
            re.IGNORECASE,
        )
        m = sf_update_re.search(command)
        if m:
            value = m.group(4).strip().strip("\"'")
            if not value or len(value) > 500:
                raise AgentSemanticValidationError(
                    "The new value must be between 1 and 500 characters"
                )
            return ProposedWriteAction(
                action_type="UPDATE_SALESFORCE_FIELD",
                sf_object=m.group(1),
                sf_record_id=m.group(2),
                sf_field=m.group(3),
                sf_value=value,
                rationale="Salesforce write-back via Executive Agentic Layer",
            )

        m = merge_re.search(command)
        if m:
            return ProposedWriteAction(
                action_type="MERGE_ENTITIES",
                entity=m.group(1),
                entity_b=m.group(2),
                rationale="Data-model curation via Executive Agentic Layer",
            )
        m = rename_re.search(command)
        if m:
            return ProposedWriteAction(
                action_type="RENAME_ENTITY",
                entity=m.group(1),
                new_name=m.group(2).strip().strip("\"'"),
                rationale="Data-model curation via Executive Agentic Layer",
            )
        m = concept_re.search(command)
        if m:
            entity = m.group(1) or m.group(3)
            concept = m.group(2) or m.group(4)
            return ProposedWriteAction(
                action_type="SET_ENTITY_CONCEPT",
                entity=entity,
                concept=concept,
                rationale="Data-model curation via Executive Agentic Layer",
            )

        for regex in (delivery_re, delivery_en_re):
            m = regex.search(command)
            if m:
                try:
                    parsed_date = date.fromisoformat(m.group(2))
                except ValueError as exc:
                    raise AgentSemanticValidationError(
                        f"Invalid date: '{m.group(2)}' is not a valid calendar date (expected YYYY-MM-DD)"
                    ) from exc
                return ProposedWriteAction(
                    action_type="UPDATE_ORDER_DELIVERY_DATE",
                    order_id=int(m.group(1)),
                    new_delivery_date=parsed_date,
                    rationale="Write-back via Executive Agentic Layer",
                )

        for regex in (status_re, status_en_re):
            m = regex.search(command)
            if m:
                raw_status = m.group(2).lower().strip()
                mapped = _STATUS_MAP.get(raw_status)
                if not mapped:
                    raise AgentSemanticValidationError(
                        f"Unrecognised status: '{raw_status}'. Valid values: shipped, delivered, processing"
                    )
                return ProposedWriteAction(
                    action_type="UPDATE_ORDER_STATUS",
                    order_id=int(m.group(1)),
                    new_status=mapped,
                    rationale="Write-back via Executive Agentic Layer",
                )

        for regex in (cancel_re, cancel_en_re):
            m = regex.search(command)
            if m:
                return ProposedWriteAction(
                    action_type="UPDATE_ORDER_STATUS",
                    order_id=int(m.group(1)),
                    new_status="cancelled",
                    rationale="Write-back via Executive Agentic Layer",
                )

        raise AgentSemanticValidationError(
            "Command not supported. Valid formats: "
            "'Update the delivery date of order <id> to YYYY-MM-DD' | "
            "'Mark order <id> as shipped/delivered' | "
            "'Cancel order <id>'"
        )

    def _validate_semantics(self, action: ProposedWriteAction) -> ValidationOutcome:
        if action.action_type in _DATA_MODEL_ACTIONS:
            return self._validate_data_model(action)
        if action.action_type in _SALESFORCE_ACTIONS:
            return self._validate_salesforce(action)

        checks: list[str] = []

        if action.order_id is None:
            return ValidationOutcome(
                passed=False,
                checks=checks,
                reason="order_id is required for order write-back actions",
            )

        ontology = self._get_ontology()
        if ontology is None:
            return ValidationOutcome(
                passed=False,
                checks=checks,
                reason="Ontology unavailable for semantic validation",
            )

        entity_names = set(ontology.entity_names())
        if "SalesOrder" not in entity_names:
            return ValidationOutcome(
                passed=False,
                checks=checks,
                reason="Ontology constraint not met: entity SalesOrder not present",
            )
        checks.append("ontology_entity_exists:SalesOrder")

        sales_order_model = ontology.entity("SalesOrder")
        model_fields = set(getattr(sales_order_model, "model_fields", {}).keys())
        if "order_date" not in model_fields:
            return ValidationOutcome(
                passed=False,
                checks=checks,
                reason="Ontology constraint not met: property order_date not present in SalesOrder",
            )
        checks.append("ontology_property_exists:SalesOrder.order_date")

        conn = self._get_db_connection()
        try:
            row = conn.execute(
                "SELECT id, date, delivery_date, status FROM orders WHERE id = ?",
                (action.order_id,),
            ).fetchone()
        finally:
            conn.close()

        if row is None:
            return ValidationOutcome(
                passed=False,
                checks=checks,
                reason=f"Order {action.order_id} not found",
            )
        checks.append("order_exists")

        if action.action_type == "UPDATE_ORDER_DELIVERY_DATE":
            assert action.new_delivery_date is not None
            order_date = date.fromisoformat(str(row["date"]))
            if action.new_delivery_date < order_date:
                return ValidationOutcome(
                    passed=False,
                    checks=checks,
                    reason="Delivery date cannot be before the order date",
                )
            checks.append("business_rule_delivery_date_gte_order_date")

        elif action.action_type == "UPDATE_ORDER_STATUS":
            assert action.new_status is not None
            current_status = str(row["status"] or "processing").lower()
            allowed = _VALID_STATUS_TRANSITIONS.get(current_status, set())
            if action.new_status not in allowed:
                return ValidationOutcome(
                    passed=False,
                    checks=checks,
                    reason=(
                        f"Invalid status transition: {current_status!r} → {action.new_status!r}. "
                        f"Allowed: {sorted(allowed) or 'none'}"
                    ),
                )
            checks.append(
                f"business_rule_valid_status_transition:{current_status}->{action.new_status}"
            )

        return ValidationOutcome(passed=True, checks=checks)

    def _resolve_entity(self, catalog: Any, ref: str) -> dict | None:
        """Resolve a user-typed entity reference (name, table or display name,
        case-insensitive) to a draft entity dict."""
        wanted = ref.strip().lower()
        for e in catalog.get_draft_entities():
            candidates = {
                str(e.get("name", "")).lower(),
                str(e.get("table", "")).lower(),
                str(e.get("display_name", "")).lower(),
            }
            if wanted in candidates:
                return e
        return None

    def _validate_salesforce(self, action: ProposedWriteAction) -> ValidationOutcome:
        """Salesforce single-field update: gateway configured, sane
        identifiers, field not a system field, and a LIVE describe confirming
        the field is updateable and the record exists. Runs at submission AND
        again at approval time (re-validation), so a permission revoked in
        Salesforce between the two blocks the write."""
        checks: list[str] = []
        if self._sf_check is None or self._sf_update is None:
            return ValidationOutcome(
                passed=False,
                checks=checks,
                reason=(
                    "Salesforce write-back is not configured — connect a "
                    "Salesforce source first"
                ),
            )
        checks.append("gateway_configured")

        obj = (action.sf_object or "").strip()
        record_id = (action.sf_record_id or "").strip()
        field = (action.sf_field or "").strip()
        value = (action.sf_value or "").strip()
        if not (obj and record_id and field and value):
            return ValidationOutcome(
                passed=False,
                checks=checks,
                reason="Object, record id, field and value are all required",
            )
        if len(record_id) not in (15, 18) or not record_id.isalnum():
            return ValidationOutcome(
                passed=False,
                checks=checks,
                reason=f"'{record_id}' is not a valid Salesforce record id",
            )
        checks.append("record_id_format")
        if field.lower() in _SF_BLOCKED_FIELDS:
            return ValidationOutcome(
                passed=False,
                checks=checks,
                reason=f"Field '{field}' is a system field and can never be updated",
            )
        checks.append("not_a_system_field")

        try:
            error = self._sf_check(obj, field, record_id)
        except Exception as exc:  # noqa: BLE001 — gateway/network issues fail closed
            return ValidationOutcome(
                passed=False,
                checks=checks,
                reason=f"Could not verify the field against Salesforce: {exc}",
            )
        if error:
            return ValidationOutcome(passed=False, checks=checks, reason=error)
        checks.append("field_updateable_and_record_exists")
        return ValidationOutcome(passed=True, checks=checks)

    def _validate_data_model(self, action: ProposedWriteAction) -> ValidationOutcome:
        """Validate data-model curation actions against the metadata catalog.

        Same contract as the order path: called at submission AND re-run at
        approval time, so a stale proposal (entity deleted meanwhile, pair
        merged by someone else) fails closed instead of executing blindly.
        """
        checks: list[str] = []

        catalog = self._get_catalog() if self._get_catalog is not None else None
        if catalog is None:
            return ValidationOutcome(
                passed=False,
                checks=checks,
                reason="Metadata catalog unavailable for data-model validation",
            )

        if not action.entity:
            return ValidationOutcome(
                passed=False, checks=checks, reason="Entity reference is required"
            )
        entity = self._resolve_entity(catalog, action.entity)
        if entity is None:
            return ValidationOutcome(
                passed=False,
                checks=checks,
                reason=f"Entity '{action.entity}' not found in the data model",
            )
        checks.append(f"entity_exists:{entity['name']}")

        if action.action_type == "MERGE_ENTITIES":
            if not action.entity_b:
                return ValidationOutcome(
                    passed=False, checks=checks, reason="Second entity is required"
                )
            entity_b = self._resolve_entity(catalog, action.entity_b)
            if entity_b is None:
                return ValidationOutcome(
                    passed=False,
                    checks=checks,
                    reason=f"Entity '{action.entity_b}' not found in the data model",
                )
            checks.append(f"entity_exists:{entity_b['name']}")
            if entity["table"] == entity_b["table"]:
                return ValidationOutcome(
                    passed=False,
                    checks=checks,
                    reason="Cannot merge an entity with itself",
                )
            pair = {entity["table"], entity_b["table"]}
            for rel in catalog.list_manual_relations():
                if (
                    rel.get("edge_type") == "SAME_AS"
                    and {rel.get("from_table"), rel.get("to_table")} == pair
                ):
                    return ValidationOutcome(
                        passed=False,
                        checks=checks,
                        reason=(
                            f"Entities '{entity['name']}' and '{entity_b['name']}' "
                            "are already merged"
                        ),
                    )
            checks.append("business_rule_not_already_merged")
            # Same pair already awaiting approval → don't queue a duplicate.
            # (At approval time this action is claimed as PROCESSING, so the
            # re-validation never collides with itself.)
            for pending in self._store.list_actions(
                status_filter="PENDING_HUMAN_APPROVAL", limit=200
            ):
                pa = pending.proposed_action
                if pa.action_type != "MERGE_ENTITIES":
                    continue
                pe = self._resolve_entity(catalog, pa.entity or "")
                pb = self._resolve_entity(catalog, pa.entity_b or "")
                if pe and pb and {pe["table"], pb["table"]} == pair:
                    return ValidationOutcome(
                        passed=False,
                        checks=checks,
                        reason=(
                            f"A merge of '{entity['name']}' and "
                            f"'{entity_b['name']}' is already pending approval"
                        ),
                    )
            checks.append("business_rule_no_duplicate_pending")

        elif action.action_type == "RENAME_ENTITY":
            new_name = (action.new_name or "").strip()
            if not (1 <= len(new_name) <= 80):
                return ValidationOutcome(
                    passed=False,
                    checks=checks,
                    reason="New name must be between 1 and 80 characters",
                )
            checks.append("business_rule_valid_display_name")

        elif action.action_type == "SET_ENTITY_CONCEPT":
            from app.semantic.canonical import known_concepts, resolve_concept_name

            resolved = resolve_concept_name(action.concept or "")
            if resolved is None:
                return ValidationOutcome(
                    passed=False,
                    checks=checks,
                    reason=(
                        f"Unknown concept '{action.concept}'. "
                        f"Valid concepts: {', '.join(known_concepts())}"
                    ),
                )
            checks.append(f"business_rule_known_concept:{resolved}")

        return ValidationOutcome(passed=True, checks=checks)

    def _execute_data_model(self, action: ProposedWriteAction) -> None:
        """Apply an approved data-model action via the metadata catalog.

        All writes go through the catalog's ORM (parameterised by
        construction) and touch only Fra's own metadata store — never a
        customer source system.
        """
        catalog = self._get_catalog() if self._get_catalog is not None else None
        if catalog is None:
            raise AgentExecutionError("Metadata catalog unavailable")

        entity = self._resolve_entity(catalog, action.entity or "")
        if entity is None:
            raise AgentExecutionError(f"Entity '{action.entity}' not found")

        if action.action_type == "MERGE_ENTITIES":
            entity_b = self._resolve_entity(catalog, action.entity_b or "")
            if entity_b is None:
                raise AgentExecutionError(f"Entity '{action.entity_b}' not found")
            catalog.add_manual_relation(
                from_table=entity["table"],
                to_table=entity_b["table"],
                via_column="",
                edge_type="SAME_AS",
            )
            # Learning loop: the approved association becomes a workspace
            # alias so future sources match deterministically. Best-effort.
            try:
                from app.curation.learning import record_merge  # noqa: PLC0415

                record_merge(entity, entity_b)
            except Exception:  # noqa: BLE001 — never fail the approved action
                logger.debug("curation learning hook failed", exc_info=True)
        elif action.action_type == "RENAME_ENTITY":
            if not catalog.set_entity_display(
                entity["name"], display_name=(action.new_name or "").strip()
            ):
                raise AgentExecutionError(f"Could not rename entity '{entity['name']}'")
        elif action.action_type == "SET_ENTITY_CONCEPT":
            from app.semantic.canonical import resolve_concept_name

            resolved = resolve_concept_name(action.concept or "")
            if resolved is None:
                raise AgentExecutionError(f"Unknown concept '{action.concept}'")
            if not catalog.set_entity_display(entity["name"], canonical=resolved):
                raise AgentExecutionError(
                    f"Could not set concept on entity '{entity['name']}'"
                )
            try:
                from app.curation.learning import record_concept  # noqa: PLC0415

                record_concept(entity, resolved)
            except Exception:  # noqa: BLE001 — never fail the approved action
                logger.debug("curation learning hook failed", exc_info=True)
        else:  # pragma: no cover — guarded by the caller's dispatch
            raise AgentExecutionError(f"Unsupported action_type: {action.action_type}")

    def _compute_action_effect(self, action: ProposedWriteAction) -> "ActionEffect":
        if action.action_type in _SALESFORCE_ACTIONS:
            # The write happened in Salesforce, not in the local store: with
            # metadata-only ingestion there is nothing local to resync.
            return ActionEffect(
                action_type=action.action_type,
                changed_fields={
                    f"{action.sf_object}.{action.sf_field}": action.sf_value
                },
            )

        if action.action_type == "UPDATE_ORDER_DELIVERY_DATE":
            return ActionEffect(
                action_type=action.action_type,
                affected_tables=["orders"],
                affected_node_ids=[f"order:{action.order_id}"],
                changed_fields={
                    "delivery_date": action.new_delivery_date.isoformat()
                    if action.new_delivery_date
                    else ""
                },
                entity_types=["SalesOrder"],
            )
        if action.action_type == "UPDATE_ORDER_STATUS":
            return ActionEffect(
                action_type=action.action_type,
                affected_tables=["orders"],
                affected_node_ids=[f"order:{action.order_id}"],
                changed_fields={"status": action.new_status or ""},
                entity_types=["SalesOrder"],
            )
        if action.action_type == "MERGE_ENTITIES":
            # Resolve to physical tables so the KG patcher can add the
            # SAME_AS edge immediately (raw user refs may be display names).
            tables = [t for t in (action.entity, action.entity_b) if t]
            try:
                catalog = self._get_catalog() if self._get_catalog else None
                if catalog is not None:
                    resolved = [
                        (self._resolve_entity(catalog, ref) or {}).get("table")
                        for ref in tables
                    ]
                    if all(resolved):
                        tables = resolved  # type: ignore[assignment]
            except Exception:  # noqa: BLE001 — effect metadata must not fail
                pass
            return ActionEffect(
                action_type=action.action_type,
                affected_tables=tables,
                changed_fields={"edge_type": "SAME_AS"},
                entity_types=tables,
            )
        if action.action_type in ("RENAME_ENTITY", "SET_ENTITY_CONCEPT"):
            return ActionEffect(
                action_type=action.action_type,
                affected_tables=[action.entity] if action.entity else [],
                changed_fields=(
                    {"display_name": action.new_name or ""}
                    if action.action_type == "RENAME_ENTITY"
                    else {"canonical": action.concept or ""}
                ),
                entity_types=[action.entity] if action.entity else [],
            )
        return ActionEffect(action_type=action.action_type)

    def _propagate_changes(self, effect: "ActionEffect") -> "ResyncResult":
        import time

        t0 = time.monotonic()
        nodes_patched = 0
        cache_invalidated = 0
        errors: list[str] = []

        if self._kg_patcher is not None:
            try:
                nodes_patched = self._kg_patcher(effect)
            except Exception as exc:
                errors.append(f"kg_patch_error: {exc}")

        if self._cache_invalidator is not None:
            try:
                cache_invalidated = self._cache_invalidator()
            except Exception as exc:
                errors.append(f"cache_invalidation_error: {exc}")

        duration_ms = (time.monotonic() - t0) * 1000
        return ResyncResult(
            nodes_patched=nodes_patched,
            cache_keys_invalidated=cache_invalidated,
            duration_ms=round(duration_ms, 2),
            errors=errors,
        )

    def _execute_writeback(self, action: ProposedWriteAction) -> None:
        if action.action_type in _DATA_MODEL_ACTIONS:
            self._execute_data_model(action)
            return
        if action.action_type in _SALESFORCE_ACTIONS:
            if self._sf_update is None:  # pragma: no cover — validation blocks this
                raise AgentExecutionError("Salesforce write-back is not configured")
            assert action.sf_object and action.sf_record_id
            assert action.sf_field and action.sf_value is not None
            try:
                self._sf_update(
                    action.sf_object,
                    action.sf_record_id,
                    action.sf_field,
                    action.sf_value,
                )
            except Exception as exc:
                # The gateway error can carry instance URLs/response bodies —
                # keep the user-facing message clean, log the detail.
                logger.warning("salesforce write-back failed: %s", exc)
                raise AgentExecutionError(
                    f"Salesforce rejected the update of "
                    f"{action.sf_object}/{action.sf_record_id}.{action.sf_field}"
                ) from exc
            return

        conn = self._get_db_connection()
        try:
            if action.action_type == "UPDATE_ORDER_DELIVERY_DATE":
                assert action.new_delivery_date is not None
                cursor = conn.execute(
                    "UPDATE orders SET delivery_date = ? WHERE id = ?",
                    (action.new_delivery_date.isoformat(), action.order_id),
                )
            elif action.action_type == "UPDATE_ORDER_STATUS":
                assert action.new_status is not None
                cursor = conn.execute(
                    "UPDATE orders SET status = ? WHERE id = ?",
                    (action.new_status, action.order_id),
                )
            else:
                raise AgentExecutionError(
                    f"Unsupported action_type: {action.action_type}"
                )
            conn.commit()
        finally:
            conn.close()

        if cursor.rowcount == 0:
            raise AgentExecutionError(f"No rows updated for order {action.order_id}")

    def _audit(
        self,
        phase: Literal[
            "PROPOSED",
            "VALIDATED",
            "QUEUED",
            "APPROVED",
            "REJECTED",
            "EXECUTED",
            "RESYNCED",
            "FAILED",
        ],
        actor: str,
        actor_role: str,
        details: dict[str, Any],
        action_id: str | None = None,
    ) -> None:
        record = AgentAuditRecord(
            action_id=action_id,
            phase=phase,
            actor=actor,
            actor_role=actor_role,
            details=details,
        )
        logger.info(
            "AGENT_AUDIT %s",
            json.dumps(record.model_dump(mode="json"), ensure_ascii=True),
        )
        self._store.append_audit(record)
