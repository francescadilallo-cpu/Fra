"""Unit tests for agentic/executive.py — _parse_command, constants,
submit_command, approve_action, and audit log.

DB connection is mocked with a real in-memory SQLite database so
no external dependencies are required.
"""

from __future__ import annotations

import sqlite3
import sys
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.agentic.executive import (
    AgentActionNotFoundError,
    AgentExecutionError,
    AgentSemanticValidationError,
    ExecutiveAgenticLayer,
    ProposedWriteAction,
    _STATUS_IT_MAP,
    _VALID_STATUS_TRANSITIONS,
)


# ── Constants ──────────────────────────────────────────────────────────────────


class TestStatusConstants:
    def test_status_it_map_spedito(self):
        assert _STATUS_IT_MAP["spedito"] == "shipped"

    def test_status_it_map_consegnato(self):
        assert _STATUS_IT_MAP["consegnato"] == "delivered"

    def test_status_it_map_in_lavorazione(self):
        assert _STATUS_IT_MAP["in lavorazione"] == "processing"

    def test_valid_transitions_processing(self):
        assert "shipped" in _VALID_STATUS_TRANSITIONS["processing"]
        assert "cancelled" in _VALID_STATUS_TRANSITIONS["processing"]

    def test_valid_transitions_shipped(self):
        assert "delivered" in _VALID_STATUS_TRANSITIONS["shipped"]

    def test_terminal_states_have_no_transitions(self):
        assert _VALID_STATUS_TRANSITIONS["delivered"] == set()
        assert _VALID_STATUS_TRANSITIONS["cancelled"] == set()


# ── _parse_command ─────────────────────────────────────────────────────────────


def _make_layer() -> ExecutiveAgenticLayer:
    return ExecutiveAgenticLayer(
        get_ontology=lambda: None,
        get_db_connection=lambda: None,
    )


class TestParseCommand:
    def setup_method(self):
        self.layer = _make_layer()

    def _parse(self, cmd: str) -> ProposedWriteAction:
        return self.layer._parse_command(cmd)

    def test_delivery_date_update(self):
        action = self._parse("Sposta la data di consegna dell'ordine 42 al 2025-03-15")
        assert action.action_type == "UPDATE_ORDER_DELIVERY_DATE"
        assert action.order_id == 42
        assert action.new_delivery_date == date(2025, 3, 15)

    def test_delivery_date_update_case_insensitive(self):
        action = self._parse("sposta la data di consegna dell'ordine 1 al 2025-01-01")
        assert action.action_type == "UPDATE_ORDER_DELIVERY_DATE"
        assert action.order_id == 1

    def test_delivery_date_update_alla_variant(self):
        action = self._parse(
            "Sposta la data di consegna dell'ordine 10 alla 2025-06-30"
        )
        assert action.order_id == 10
        assert action.new_delivery_date == date(2025, 6, 30)

    def test_mark_order_spedito(self):
        action = self._parse("Segna l'ordine 5 come spedito")
        assert action.action_type == "UPDATE_ORDER_STATUS"
        assert action.order_id == 5
        assert action.new_status == "shipped"

    def test_mark_order_consegnato(self):
        action = self._parse("Segna l'ordine 7 come consegnato")
        assert action.new_status == "delivered"

    def test_mark_order_in_lavorazione(self):
        action = self._parse("Marca l'ordine 3 come in lavorazione")
        assert action.new_status == "processing"

    def test_mark_order_in_elaborazione(self):
        action = self._parse("Segna l'ordine 3 come in elaborazione")
        assert action.new_status == "processing"

    def test_cancel_order(self):
        action = self._parse("Cancella l'ordine 99")
        assert action.action_type == "UPDATE_ORDER_STATUS"
        assert action.order_id == 99
        assert action.new_status == "cancelled"

    def test_annulla_order(self):
        action = self._parse("Annulla l'ordine 12")
        assert action.new_status == "cancelled"

    def test_unsupported_command_raises(self):
        with pytest.raises(AgentSemanticValidationError, match="not supported"):
            self._parse("Crea un nuovo ordine per cliente 5")

    def test_empty_command_raises(self):
        with pytest.raises(AgentSemanticValidationError):
            self.layer.submit_command("", actor="user", actor_role="admin")

    def test_rationale_always_set(self):
        action = self._parse("Cancella l'ordine 1")
        assert action.rationale

    def test_unrecognized_italian_status_raises(self):
        with pytest.raises(AgentSemanticValidationError):
            self._parse("Segna l'ordine 1 come sospeso")

    # ── English command patterns ───────────────────────────────────────────────

    def test_english_update_delivery_date(self):
        action = self._parse("Update the delivery date of order 42 to 2025-03-15")
        assert action.action_type == "UPDATE_ORDER_DELIVERY_DATE"
        assert action.order_id == 42
        assert action.new_delivery_date == date(2025, 3, 15)

    def test_english_change_delivery_date(self):
        action = self._parse("change delivery date of order 7 to 2025-06-01")
        assert action.action_type == "UPDATE_ORDER_DELIVERY_DATE"
        assert action.order_id == 7
        assert action.new_delivery_date == date(2025, 6, 1)

    def test_english_set_delivery_date(self):
        action = self._parse("Set delivery date 100 to 2026-01-15")
        assert action.action_type == "UPDATE_ORDER_DELIVERY_DATE"
        assert action.order_id == 100

    def test_english_mark_order_shipped(self):
        action = self._parse("Mark order 5 as shipped")
        assert action.action_type == "UPDATE_ORDER_STATUS"
        assert action.order_id == 5
        assert action.new_status == "shipped"

    def test_english_mark_order_delivered(self):
        action = self._parse("mark order 10 as delivered")
        assert action.action_type == "UPDATE_ORDER_STATUS"
        assert action.new_status == "delivered"

    def test_english_mark_order_processing(self):
        action = self._parse("set order 3 as processing")
        assert action.action_type == "UPDATE_ORDER_STATUS"
        assert action.new_status == "processing"

    def test_english_mark_order_in_processing(self):
        action = self._parse("Mark order 8 as in processing")
        assert action.action_type == "UPDATE_ORDER_STATUS"
        assert action.new_status == "processing"

    def test_english_cancel_order(self):
        action = self._parse("cancel order 99")
        assert action.action_type == "UPDATE_ORDER_STATUS"
        assert action.order_id == 99
        assert action.new_status == "cancelled"

    def test_english_unsupported_command_raises(self):
        with pytest.raises(AgentSemanticValidationError, match="not supported"):
            self._parse("Create a new order for customer 5")

    def test_impossible_calendar_date_raises_validation_error(self):
        # 2025-13-45 is syntactically well-formed but not a real date.
        # Must surface as AgentSemanticValidationError (422), not an uncaught
        # ValueError that would become a 500.
        with pytest.raises(AgentSemanticValidationError, match="[Ii]nvalid date"):
            self._parse("Sposta la data di consegna dell'ordine 5 al 2025-13-45")


# ── ExecutiveAgenticLayer with mocked DB and ontology ─────────────────────────


def _make_mock_ontology():
    """Ontology mock that passes all semantic validations."""
    ontology = MagicMock()
    ontology.entity_names.return_value = ["SalesOrder", "Customer", "Product"]
    salesorder_model = MagicMock()
    salesorder_model.model_fields = {
        "order_id": None,
        "order_date": None,
        "status_code": None,
    }
    ontology.entity.return_value = salesorder_model
    return ontology


def _make_test_db(orders: list[dict] | None = None) -> sqlite3.Connection:
    """Create an in-memory DB with an orders table for validation testing."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE orders (
            id INTEGER PRIMARY KEY,
            date TEXT NOT NULL,
            delivery_date TEXT NOT NULL,
            status TEXT NOT NULL
        )
    """)
    for row in orders or []:
        conn.execute(
            "INSERT INTO orders (id, date, delivery_date, status) VALUES (?,?,?,?)",
            (row["id"], row["date"], row["delivery_date"], row["status"]),
        )
    conn.commit()
    return conn


def _make_layer_with_db(
    orders: list[dict] | None = None, state_db_path=None
) -> ExecutiveAgenticLayer:
    ontology = _make_mock_ontology()

    # Each call to get_db_connection returns a fresh connection (closes after validate)
    def _get_conn():
        return _make_test_db(orders)

    return ExecutiveAgenticLayer(
        get_ontology=lambda: ontology,
        get_db_connection=_get_conn,
        state_db_path=state_db_path,
    )


class TestSubmitCommand:
    def test_submit_valid_command_returns_action(self):
        layer = _make_layer_with_db(
            [
                {
                    "id": 10,
                    "date": "2024-01-01",
                    "delivery_date": "2024-02-01",
                    "status": "processing",
                }
            ]
        )
        action = layer.submit_command(
            "Cancella l'ordine 10", actor="manager1", actor_role="admin"
        )
        assert action.action_id
        assert action.status == "PENDING_HUMAN_APPROVAL"
        assert action.proposed_action.order_id == 10

    def test_submit_unknown_order_raises_validation_error(self):
        layer = _make_layer_with_db([])
        with pytest.raises(AgentSemanticValidationError, match="not found"):
            layer.submit_command(
                "Cancella l'ordine 999", actor="user", actor_role="admin"
            )

    def test_submit_duplicate_status_transition_fails(self):
        # delivered → shipped is forbidden
        layer = _make_layer_with_db(
            [
                {
                    "id": 20,
                    "date": "2024-01-01",
                    "delivery_date": "2024-02-01",
                    "status": "delivered",
                }
            ]
        )
        with pytest.raises(
            AgentSemanticValidationError, match="[Ii]nvalid status transition"
        ):
            layer.submit_command(
                "Segna l'ordine 20 come spedito", actor="u", actor_role="a"
            )

    def test_pending_action_stored(self):
        layer = _make_layer_with_db(
            [
                {
                    "id": 5,
                    "date": "2024-01-01",
                    "delivery_date": "2024-02-01",
                    "status": "processing",
                }
            ]
        )
        action = layer.submit_command("Cancella l'ordine 5", actor="u", actor_role="a")
        actions = layer.list_actions()
        assert any(a.action_id == action.action_id for a in actions)


class TestApproveAction:
    def test_reject_action_sets_rejected_status(self):
        layer = _make_layer_with_db(
            [
                {
                    "id": 1,
                    "date": "2024-01-01",
                    "delivery_date": "2024-02-01",
                    "status": "processing",
                }
            ]
        )
        action = layer.submit_command("Cancella l'ordine 1", actor="u", actor_role="a")
        result = layer.approve_action(
            action.action_id,
            actor="mgr",
            actor_role="admin",
            approve=False,
            manager_note="Not now",
        )
        assert result.status == "REJECTED"
        assert result.manager_note == "Not now"

    def test_approve_nonexistent_raises_not_found(self):
        layer = _make_layer_with_db([])
        with pytest.raises(AgentActionNotFoundError):
            layer.approve_action(
                "bad-id", actor="u", actor_role="a", approve=True, manager_note=None
            )

    def test_list_actions_with_status_filter(self):
        layer = _make_layer_with_db(
            [
                {
                    "id": 2,
                    "date": "2024-01-01",
                    "delivery_date": "2024-02-01",
                    "status": "processing",
                }
            ]
        )
        action = layer.submit_command("Cancella l'ordine 2", actor="u", actor_role="a")
        pending = layer.list_actions(status_filter="PENDING_HUMAN_APPROVAL")
        assert any(a.action_id == action.action_id for a in pending)

    def test_approve_already_rejected_raises(self):
        layer = _make_layer_with_db(
            [
                {
                    "id": 3,
                    "date": "2024-01-01",
                    "delivery_date": "2024-02-01",
                    "status": "processing",
                }
            ]
        )
        action = layer.submit_command("Cancella l'ordine 3", actor="u", actor_role="a")
        layer.approve_action(
            action.action_id, "mgr", "admin", approve=False, manager_note=None
        )
        with pytest.raises(AgentExecutionError, match="cannot be approved"):
            layer.approve_action(
                action.action_id, "mgr", "admin", approve=True, manager_note=None
            )


class TestApprovalRevalidatesAgainstCurrentState:
    """_validate_semantics runs at *submission* time, but approval is an
    asynchronous, human-gated step that can happen long after — the order may
    have moved on (via this or another action, or a direct write) by the time
    a manager acts on a now-stale proposal. approve_action must re-check
    against current state before writing anything, instead of blindly
    replaying a decision based on data that no longer holds."""

    def test_approve_rejects_proposal_invalidated_by_status_change_since_submission(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        orders = [
            {
                "id": 40,
                "date": "2024-01-01",
                "delivery_date": "2024-02-01",
                "status": "processing",
            }
        ]
        layer = _make_layer_with_db(orders)

        action = layer.submit_command(
            "Segna l'ordine 40 come spedito", actor="u", actor_role="a"
        )
        assert action.status == "PENDING_HUMAN_APPROVAL"

        # Out-of-band change between proposal and approval — e.g. another
        # approved action (or a direct write) already moved the order to a
        # terminal state. "delivered" -> "shipped" is not a valid transition.
        orders[0]["status"] = "delivered"

        writeback = MagicMock()
        monkeypatch.setattr(layer, "_execute_writeback", writeback)

        with pytest.raises(AgentExecutionError, match="[Ii]nvalid status transition"):
            layer.approve_action(
                action.action_id,
                actor="mgr",
                actor_role="admin",
                approve=True,
                manager_note=None,
            )

        writeback.assert_not_called()
        stored = layer.get_action(action.action_id)
        assert stored is not None
        assert stored.status == "FAILED"

    def test_approve_rejects_proposal_for_order_removed_since_submission(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        orders = [
            {
                "id": 41,
                "date": "2024-01-01",
                "delivery_date": "2024-02-01",
                "status": "processing",
            }
        ]
        layer = _make_layer_with_db(orders)

        action = layer.submit_command("Cancella l'ordine 41", actor="u", actor_role="a")

        # The order is gone by approval time (e.g. purged or merged elsewhere).
        orders.clear()

        writeback = MagicMock()
        monkeypatch.setattr(layer, "_execute_writeback", writeback)

        with pytest.raises(AgentExecutionError, match="not found"):
            layer.approve_action(
                action.action_id,
                actor="mgr",
                actor_role="admin",
                approve=True,
                manager_note=None,
            )

        writeback.assert_not_called()
        stored = layer.get_action(action.action_id)
        assert stored is not None
        assert stored.status == "FAILED"

    def test_approve_executes_when_state_unchanged_since_submission(self) -> None:
        """Sanity check: re-validation must not be overly strict — a proposal
        whose underlying state hasn't moved should still execute normally."""
        orders = [
            {
                "id": 42,
                "date": "2024-01-01",
                "delivery_date": "2024-02-01",
                "status": "processing",
            }
        ]
        layer = _make_layer_with_db(orders)

        action = layer.submit_command(
            "Segna l'ordine 42 come spedito", actor="u", actor_role="a"
        )

        result = layer.approve_action(
            action.action_id,
            actor="mgr",
            actor_role="admin",
            approve=True,
            manager_note=None,
        )

        assert result.status == "SYNCED"


class TestAuditLog:
    def test_submit_creates_audit_entries(self):
        layer = _make_layer_with_db(
            [
                {
                    "id": 4,
                    "date": "2024-01-01",
                    "delivery_date": "2024-02-01",
                    "status": "processing",
                }
            ]
        )
        layer.submit_command("Cancella l'ordine 4", actor="u", actor_role="a")
        log = layer.get_audit_log()
        assert len(log) >= 1
        phases = {entry.phase for entry in log}
        assert "PROPOSED" in phases

    def test_audit_log_limit(self):
        layer = _make_layer_with_db(
            [
                {
                    "id": 6,
                    "date": "2024-01-01",
                    "delivery_date": "2024-02-01",
                    "status": "processing",
                }
            ]
        )
        layer.submit_command("Cancella l'ordine 6", actor="u", actor_role="a")
        # Requesting limit=1 should return at most 1 entry
        log = layer.get_audit_log(limit=1)
        assert len(log) <= 1

    def test_audit_log_is_bounded_ring_buffer(self):
        # The audit log must not grow without bound — the store keeps at most
        # max_audit records, evicting the oldest instead of leaking.
        layer = _make_layer()
        cap = 10
        layer._store._max_audit = cap  # shrink for a fast test
        for i in range(cap + 25):
            layer._audit(
                phase="PROPOSED",
                actor="u",
                actor_role="a",
                details={"i": i},
            )
        assert layer._store.audit_count() <= cap
        # Oldest entries were evicted; newest is preserved.
        newest = layer.get_audit_log(limit=1)[0]
        assert newest.details["i"] == cap + 24


class TestListActions:
    def test_list_actions_empty_initially(self):
        layer = _make_layer_with_db([])
        assert layer.list_actions() == []

    def test_list_actions_without_filter_returns_all(self):
        layer = _make_layer_with_db(
            [
                {
                    "id": 10,
                    "date": "2024-01-01",
                    "delivery_date": "2024-02-01",
                    "status": "processing",
                },
                {
                    "id": 11,
                    "date": "2024-01-01",
                    "delivery_date": "2024-02-01",
                    "status": "processing",
                },
            ]
        )
        layer.submit_command("Cancella l'ordine 10", actor="u", actor_role="a")
        layer.submit_command("Cancella l'ordine 11", actor="u", actor_role="a")
        assert len(layer.list_actions()) == 2


class TestStatePersistence:
    """A file-backed layer must share its state across instances — the
    multi-worker / survives-restart guarantee."""

    def test_action_submitted_on_one_layer_visible_on_another(self, tmp_path):
        orders = [
            {
                "id": 10,
                "date": "2024-01-01",
                "delivery_date": "2024-02-01",
                "status": "processing",
            }
        ]
        db = tmp_path / "agent_state.db"
        # Worker A submits.
        layer_a = _make_layer_with_db(orders, state_db_path=db)
        action = layer_a.submit_command(
            "Cancella l'ordine 10", actor="u", actor_role="a"
        )

        # Worker B (separate layer, same file) sees it and can approve it.
        layer_b = _make_layer_with_db(orders, state_db_path=db)
        seen = layer_b.get_action(action.action_id)
        assert seen is not None
        assert seen.status == "PENDING_HUMAN_APPROVAL"

        result = layer_b.approve_action(
            action.action_id,
            actor="mgr",
            actor_role="admin",
            approve=False,
            manager_note="handled on B",
        )
        assert result.status == "REJECTED"

        # The rejection is visible back on worker A.
        assert layer_a.get_action(action.action_id).status == "REJECTED"

    def test_double_approval_from_two_workers_executes_exactly_once(
        self, tmp_path
    ) -> None:
        """Regression: two workers racing approve_action() on the same
        action_id must not both execute the writeback and append duplicate
        EXECUTED/RESYNCED audit entries. The first caller wins via
        claim_pending_action()'s SQL compare-and-swap; the second raises
        AgentExecutionError(\"cannot be approved\") without touching the DB."""
        orders = [
            {
                "id": 20,
                "date": "2024-01-01",
                "delivery_date": "2024-02-01",
                "status": "processing",
            }
        ]
        db = tmp_path / "agent_state.db"
        layer_a = _make_layer_with_db(orders, state_db_path=db)
        layer_b = _make_layer_with_db(orders, state_db_path=db)

        action = layer_a.submit_command(
            "Cancella l'ordine 20", actor="u", actor_role="a"
        )

        # Worker A approves first.
        result_a = layer_a.approve_action(
            action.action_id, "mgr", "admin", approve=True, manager_note=None
        )
        assert result_a.status in {"SYNCED", "SYNC_FAILED", "EXECUTED", "FAILED"}

        # Worker B tries to approve the same action — must be rejected.
        with pytest.raises(AgentExecutionError, match="cannot be approved"):
            layer_b.approve_action(
                action.action_id, "mgr2", "admin", approve=True, manager_note=None
            )

        # Exactly one EXECUTED entry in the audit trail for this action.
        audit_entries = [
            r
            for r in layer_a.get_audit_log(limit=100)
            if r.action_id == action.action_id and r.phase == "EXECUTED"
        ]
        assert len(audit_entries) == 1, (
            "the writeback must execute exactly once — two workers approved "
            f"the same action but {len(audit_entries)} EXECUTED audit "
            "entries were appended"
        )


# ── Data-model curation actions (MERGE / RENAME / SET_CONCEPT) ────────────────


class _FakeCatalog:
    """Minimal stand-in for MetadataCatalog covering the layer's needs."""

    def __init__(self):
        self.entities = [
            {
                "name": "sf_x_account",
                "table": "sf_x_account",
                "display_name": "Account",
            },
            {"name": "crm_accounts", "table": "crm_accounts"},
        ]
        self.manual_relations: list[dict] = []
        self.display_calls: list[tuple] = []

    def get_draft_entities(self):
        return self.entities

    def list_manual_relations(self):
        return self.manual_relations

    def add_manual_relation(self, from_table, to_table, via_column="", edge_type="FK"):
        self.manual_relations.append(
            {
                "from_table": from_table,
                "to_table": to_table,
                "via_column": via_column,
                "edge_type": edge_type,
            }
        )
        return len(self.manual_relations)

    def set_entity_display(self, name, display_name=None, canonical=None):
        self.display_calls.append((name, display_name, canonical))
        return True


def _make_dm_layer(catalog=None):
    return ExecutiveAgenticLayer(
        get_ontology=lambda: None,
        get_db_connection=lambda: None,
        get_catalog=(lambda: catalog) if catalog is not None else None,
    )


class TestParseDataModelCommands:
    def setup_method(self):
        self.layer = _make_dm_layer()

    def test_merge_italian(self):
        a = self.layer._parse_command("Unisci le entità sf_x_account e crm_accounts")
        assert a.action_type == "MERGE_ENTITIES"
        assert (a.entity, a.entity_b) == ("sf_x_account", "crm_accounts")

    def test_merge_english(self):
        a = self.layer._parse_command("merge entities sf_x_account and crm_accounts")
        assert a.action_type == "MERGE_ENTITIES"

    def test_rename_italian_multiword(self):
        a = self.layer._parse_command(
            "Rinomina l'entità crm_accounts in Clienti Chiave"
        )
        assert a.action_type == "RENAME_ENTITY"
        assert a.new_name == "Clienti Chiave"

    def test_rename_english(self):
        a = self.layer._parse_command("rename entity crm_accounts to Key Customers")
        assert (a.action_type, a.new_name) == ("RENAME_ENTITY", "Key Customers")

    def test_concept_italian(self):
        a = self.layer._parse_command(
            "Assegna l'entità crm_accounts al concetto Customer"
        )
        assert (a.action_type, a.entity, a.concept) == (
            "SET_ENTITY_CONCEPT",
            "crm_accounts",
            "Customer",
        )

    def test_concept_english(self):
        a = self.layer._parse_command("assign entity crm_accounts to concept Customer")
        assert a.action_type == "SET_ENTITY_CONCEPT"


class TestDataModelLifecycle:
    def setup_method(self):
        self.catalog = _FakeCatalog()
        self.layer = _make_dm_layer(self.catalog)

    def test_merge_queues_then_executes_on_approval(self):
        action = self.layer.submit_command(
            "unisci le entità Account e crm_accounts", "alice", "admin"
        )
        # HITL invariant: nothing written at submission time.
        assert action.status == "PENDING_HUMAN_APPROVAL"
        assert self.catalog.manual_relations == []

        done = self.layer.approve_action(
            action.action_id, "boss", "admin", approve=True, manager_note=None
        )
        assert done.status in ("SYNCED", "SYNC_FAILED")
        assert self.catalog.manual_relations == [
            {
                "from_table": "sf_x_account",  # resolved via display name
                "to_table": "crm_accounts",
                "via_column": "",
                "edge_type": "SAME_AS",
            }
        ]

    def test_merge_already_merged_fails_at_submit(self):
        self.catalog.manual_relations.append(
            {
                "from_table": "crm_accounts",
                "to_table": "sf_x_account",
                "via_column": "",
                "edge_type": "SAME_AS",
            }
        )
        with pytest.raises(AgentSemanticValidationError, match="already merged"):
            self.layer.submit_command(
                "merge entities sf_x_account and crm_accounts", "alice", "admin"
            )

    def test_merge_with_itself_rejected(self):
        with pytest.raises(AgentSemanticValidationError, match="itself"):
            self.layer.submit_command(
                "merge entities Account and sf_x_account", "alice", "admin"
            )

    def test_unknown_entity_rejected(self):
        with pytest.raises(AgentSemanticValidationError, match="not found"):
            self.layer.submit_command(
                "rename entity ghost_table to Nice Name", "alice", "admin"
            )

    def test_rename_executes_display_override(self):
        action = self.layer.submit_command(
            "rinomina l'entità crm_accounts in Clienti Chiave", "alice", "admin"
        )
        assert self.catalog.display_calls == []
        self.layer.approve_action(
            action.action_id, "boss", "admin", approve=True, manager_note=None
        )
        assert self.catalog.display_calls == [("crm_accounts", "Clienti Chiave", None)]

    def test_concept_alias_resolves_to_canonical(self):
        action = self.layer.submit_command(
            "assegna l'entità crm_accounts al concetto clienti", "alice", "admin"
        )
        self.layer.approve_action(
            action.action_id, "boss", "admin", approve=True, manager_note=None
        )
        assert self.catalog.display_calls == [("crm_accounts", None, "Customer")]

    def test_unknown_concept_rejected_with_valid_list(self):
        with pytest.raises(AgentSemanticValidationError, match="Valid concepts"):
            self.layer.submit_command(
                "assign entity crm_accounts to concept Widget", "alice", "admin"
            )

    def test_rejection_writes_nothing(self):
        action = self.layer.submit_command(
            "merge entities Account and crm_accounts", "alice", "admin"
        )
        done = self.layer.approve_action(
            action.action_id, "boss", "admin", approve=False, manager_note="no"
        )
        assert done.status == "REJECTED"
        assert self.catalog.manual_relations == []
        assert self.catalog.display_calls == []

    def test_no_catalog_fails_closed(self):
        layer = _make_dm_layer()
        with pytest.raises(AgentSemanticValidationError, match="catalog unavailable"):
            layer.submit_command("merge entities a and b", "alice", "admin")
