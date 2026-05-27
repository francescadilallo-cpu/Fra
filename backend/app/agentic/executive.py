from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import UTC, date, datetime
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class AgentSemanticValidationError(Exception):
    """Raised when an executive action violates ontology or business constraints."""


class AgentActionNotFoundError(Exception):
    """Raised when an action_id does not exist in pending queue."""


class AgentExecutionError(Exception):
    """Raised when approved action execution fails."""


AgentStatus = Literal[
    "PENDING_HUMAN_APPROVAL",
    "VALIDATION_FAILED",
    "REJECTED",
    "EXECUTED",
    "FAILED",
]


class ProposedWriteAction(BaseModel):
    action_type: Literal["UPDATE_ORDER_DELIVERY_DATE"]
    order_id: int
    new_delivery_date: date
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
    ) -> None:
        self._get_ontology = get_ontology
        self._get_db_connection = get_db_connection
        self._lock = threading.RLock()
        self._pending_actions: dict[str, PendingAgentAction] = {}
        self._audit_log: list[AgentAuditRecord] = []

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

        with self._lock:
            self._pending_actions[action_id] = action

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
        with self._lock:
            action = self._pending_actions.get(action_id)
            if not action:
                raise AgentActionNotFoundError(f"Action '{action_id}' not found")

            if action.status != "PENDING_HUMAN_APPROVAL":
                raise AgentExecutionError(
                    f"Action '{action_id}' is in status '{action.status}' and cannot be approved"
                )

            action.manager_note = manager_note
            action.updated_at = datetime.now(UTC).isoformat()

            if not approve:
                action.status = "REJECTED"
                self._pending_actions[action_id] = action
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
                self._execute_writeback(action.proposed_action)
                action.status = "EXECUTED"
                action.updated_at = datetime.now(UTC).isoformat()
                self._pending_actions[action_id] = action
                self._audit(
                    phase="EXECUTED",
                    action_id=action_id,
                    actor=actor,
                    actor_role=actor_role,
                    details={"action": action.proposed_action.model_dump(mode="json")},
                )
                return action
            except Exception as exc:
                action.status = "FAILED"
                action.updated_at = datetime.now(UTC).isoformat()
                self._pending_actions[action_id] = action
                self._audit(
                    phase="FAILED",
                    action_id=action_id,
                    actor=actor,
                    actor_role=actor_role,
                    details={"error": str(exc)},
                )
                raise AgentExecutionError(str(exc)) from exc

    def get_audit_log(self, limit: int = 200) -> list[AgentAuditRecord]:
        with self._lock:
            return list(self._audit_log[-limit:])

    def _parse_command(self, command: str) -> ProposedWriteAction:
        import re

        pattern = re.compile(
            r"sposta\s+la\s+data\s+di\s+consegna\s+dell[' ]ordine\s+(\d+)\s+(?:al|alla|a)\s+(\d{4}-\d{2}-\d{2})",
            re.IGNORECASE,
        )
        match = pattern.search(command)
        if not match:
            raise AgentSemanticValidationError(
                "Comando non supportato. Usa formato: 'Sposta la data di consegna dell'ordine <id> al YYYY-MM-DD'"
            )

        order_id = int(match.group(1))
        new_date = date.fromisoformat(match.group(2))
        return ProposedWriteAction(
            action_type="UPDATE_ORDER_DELIVERY_DATE",
            order_id=order_id,
            new_delivery_date=new_date,
            rationale="Write-back governato via Executive Agentic Layer",
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
                "SELECT id, date, delivery_date FROM orders WHERE id = ?",
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

        order_date = date.fromisoformat(str(row["date"]))
        if action.new_delivery_date < order_date:
            return ValidationOutcome(
                passed=False,
                checks=checks,
                reason="La data di consegna non puo essere antecedente alla data ordine",
            )
        checks.append("business_rule_delivery_date_gte_order_date")

        return ValidationOutcome(passed=True, checks=checks)

    def _execute_writeback(self, action: ProposedWriteAction) -> None:
        if action.action_type != "UPDATE_ORDER_DELIVERY_DATE":
            raise AgentExecutionError(f"Unsupported action_type: {action.action_type}")

        conn = self._get_db_connection()
        try:
            cursor = conn.execute(
                "UPDATE orders SET delivery_date = ? WHERE id = ?",
                (action.new_delivery_date.isoformat(), action.order_id),
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
        with self._lock:
            self._audit_log.append(record)
