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

_STATUS_IT_MAP: dict[str, str] = {
    "spedito": "shipped",
    "consegnato": "delivered",
    "in lavorazione": "processing",
    "in elaborazione": "processing",
}

_VALID_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "processing": {"shipped", "cancelled"},
    "shipped": {"delivered"},
    "delivered": set(),
    "cancelled": set(),
}


class ProposedWriteAction(BaseModel):
    action_type: Literal["UPDATE_ORDER_DELIVERY_DATE", "UPDATE_ORDER_STATUS"]
    order_id: int
    new_delivery_date: date | None = None
    new_status: str | None = None
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
    ) -> None:
        # Local import avoids a module-level circular import (store imports the
        # action/audit models from this module).
        from .store import AgentStateStore

        self._get_ontology = get_ontology
        self._get_db_connection = get_db_connection
        self._kg_patcher = kg_patcher
        self._cache_invalidator = cache_invalidator
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
            raise AgentSemanticValidationError("Comando esecutivo vuoto")

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
            raise AgentSemanticValidationError(validation.reason or "Azione non valida")

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
                        "Rivalidazione fallita: lo stato e' cambiato dalla "
                        f"proposta originale — {revalidation.reason}"
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
                raise AgentExecutionError(str(exc)) from exc

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

        m = delivery_re.search(command)
        if m:
            try:
                parsed_date = date.fromisoformat(m.group(2))
            except ValueError as exc:
                raise AgentSemanticValidationError(
                    f"Data non valida: '{m.group(2)}' non è una data calendario reale"
                ) from exc
            return ProposedWriteAction(
                action_type="UPDATE_ORDER_DELIVERY_DATE",
                order_id=int(m.group(1)),
                new_delivery_date=parsed_date,
                rationale="Write-back governato via Executive Agentic Layer",
            )

        m = status_re.search(command)
        if m:
            italian_status = m.group(2).lower().strip()
            mapped = _STATUS_IT_MAP.get(italian_status)
            if not mapped:
                raise AgentSemanticValidationError(
                    f"Stato non riconosciuto: {italian_status}"
                )
            return ProposedWriteAction(
                action_type="UPDATE_ORDER_STATUS",
                order_id=int(m.group(1)),
                new_status=mapped,
                rationale="Write-back governato via Executive Agentic Layer",
            )

        m = cancel_re.search(command)
        if m:
            return ProposedWriteAction(
                action_type="UPDATE_ORDER_STATUS",
                order_id=int(m.group(1)),
                new_status="cancelled",
                rationale="Write-back governato via Executive Agentic Layer",
            )

        raise AgentSemanticValidationError(
            "Comando non supportato. Formati validi: "
            "'Sposta la data di consegna dell'ordine <id> al YYYY-MM-DD' | "
            "'Segna l'ordine <id> come spedito/consegnato' | "
            "'Cancella l'ordine <id>'"
        )

    def _validate_semantics(self, action: ProposedWriteAction) -> ValidationOutcome:
        checks: list[str] = []

        ontology = self._get_ontology()
        if ontology is None:
            return ValidationOutcome(
                passed=False,
                checks=checks,
                reason="Ontologia non disponibile per validazione semantica",
            )

        entity_names = set(ontology.entity_names())
        if "SalesOrder" not in entity_names:
            return ValidationOutcome(
                passed=False,
                checks=checks,
                reason="Vincolo ontologico non soddisfatto: entity SalesOrder non presente",
            )
        checks.append("ontology_entity_exists:SalesOrder")

        sales_order_model = ontology.entity("SalesOrder")
        model_fields = set(getattr(sales_order_model, "model_fields", {}).keys())
        if "order_date" not in model_fields:
            return ValidationOutcome(
                passed=False,
                checks=checks,
                reason="Vincolo ontologico non soddisfatto: property order_date non presente in SalesOrder",
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
                reason=f"Ordine {action.order_id} non trovato",
            )
        checks.append("order_exists")

        if action.action_type == "UPDATE_ORDER_DELIVERY_DATE":
            assert action.new_delivery_date is not None
            order_date = date.fromisoformat(str(row["date"]))
            if action.new_delivery_date < order_date:
                return ValidationOutcome(
                    passed=False,
                    checks=checks,
                    reason="La data di consegna non puo essere antecedente alla data ordine",
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
                        f"Transizione di stato non valida: {current_status!r} → {action.new_status!r}. "
                        f"Consentite: {sorted(allowed) or 'nessuna'}"
                    ),
                )
            checks.append(
                f"business_rule_valid_status_transition:{current_status}->{action.new_status}"
            )

        return ValidationOutcome(passed=True, checks=checks)

    def _compute_action_effect(self, action: ProposedWriteAction) -> "ActionEffect":
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
