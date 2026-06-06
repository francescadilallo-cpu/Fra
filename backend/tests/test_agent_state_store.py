"""Unit tests for AgentStateStore — agentic/store.py.

Covers in-memory isolation, file-backed persistence across instances
("restart"), pending-action upsert/list ordering, and audit ring-buffer.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.agentic.executive import (
    AgentAuditRecord,
    PendingAgentAction,
    ProposedWriteAction,
)
from app.agentic.store import AgentStateStore


def _make_action(
    action_id: str, status: str = "PENDING_HUMAN_APPROVAL"
) -> PendingAgentAction:
    return PendingAgentAction(
        action_id=action_id,
        status=status,  # type: ignore[arg-type]
        command="Cancella l'ordine 1",
        requested_by="user",
        requested_role="admin",
        proposed_action=ProposedWriteAction(
            action_type="UPDATE_ORDER_STATUS",
            order_id=1,
            new_status="cancelled",
            rationale="test",
        ),
    )


def _make_audit(i: int) -> AgentAuditRecord:
    return AgentAuditRecord(
        phase="PROPOSED",
        actor="u",
        actor_role="a",
        details={"i": i},
    )


# ── pending actions ─────────────────────────────────────────────────────────────


class TestPendingActions:
    def test_save_and_get(self):
        store = AgentStateStore()
        store.save_action(_make_action("a1"))
        got = store.get_action("a1")
        assert got is not None
        assert got.action_id == "a1"
        assert got.proposed_action.order_id == 1

    def test_get_unknown_returns_none(self):
        store = AgentStateStore()
        assert store.get_action("nope") is None

    def test_upsert_updates_status_in_place(self):
        store = AgentStateStore()
        store.save_action(_make_action("a1"))
        updated = _make_action("a1", status="REJECTED")
        store.save_action(updated)
        got = store.get_action("a1")
        assert got is not None
        assert got.status == "REJECTED"

    def test_list_returns_chronological_order(self):
        store = AgentStateStore()
        for aid in ("a1", "a2", "a3"):
            store.save_action(_make_action(aid))
        ids = [a.action_id for a in store.list_actions()]
        assert ids == ["a1", "a2", "a3"]

    def test_upsert_preserves_insertion_order(self):
        store = AgentStateStore()
        for aid in ("a1", "a2", "a3"):
            store.save_action(_make_action(aid))
        # Updating a1 must NOT move it to the end.
        store.save_action(_make_action("a1", status="REJECTED"))
        ids = [a.action_id for a in store.list_actions()]
        assert ids == ["a1", "a2", "a3"]

    def test_list_status_filter(self):
        store = AgentStateStore()
        store.save_action(_make_action("a1", status="PENDING_HUMAN_APPROVAL"))
        store.save_action(_make_action("a2", status="REJECTED"))
        pending = store.list_actions(status_filter="PENDING_HUMAN_APPROVAL")
        assert [a.action_id for a in pending] == ["a1"]

    def test_list_limit(self):
        store = AgentStateStore()
        for i in range(10):
            store.save_action(_make_action(f"a{i}"))
        last_three = store.list_actions(limit=3)
        assert [a.action_id for a in last_three] == ["a7", "a8", "a9"]


# ── audit log ─────────────────────────────────────────────────────────────────


class TestAuditLog:
    def test_append_and_get(self):
        store = AgentStateStore()
        store.append_audit(_make_audit(1))
        log = store.get_audit()
        assert len(log) == 1
        assert log[0].details["i"] == 1

    def test_get_chronological(self):
        store = AgentStateStore()
        for i in range(5):
            store.append_audit(_make_audit(i))
        log = store.get_audit()
        assert [r.details["i"] for r in log] == [0, 1, 2, 3, 4]

    def test_ring_buffer_evicts_oldest(self):
        store = AgentStateStore(max_audit=5)
        for i in range(20):
            store.append_audit(_make_audit(i))
        assert store.audit_count() <= 5
        log = store.get_audit(limit=100)
        # only the newest 5 survive
        assert [r.details["i"] for r in log] == [15, 16, 17, 18, 19]

    def test_get_limit(self):
        store = AgentStateStore()
        for i in range(10):
            store.append_audit(_make_audit(i))
        log = store.get_audit(limit=2)
        assert [r.details["i"] for r in log] == [8, 9]


# ── persistence / isolation ─────────────────────────────────────────────────────


class TestPersistence:
    def test_file_backed_survives_restart(self, tmp_path):
        db = tmp_path / "agent_state.db"
        store1 = AgentStateStore(db)
        store1.save_action(_make_action("persist1"))
        store1.append_audit(_make_audit(42))

        # Simulate a process restart / a second worker: brand-new store, same file.
        store2 = AgentStateStore(db)
        got = store2.get_action("persist1")
        assert got is not None
        assert got.action_id == "persist1"
        assert store2.get_audit()[0].details["i"] == 42

    def test_file_backed_shared_across_instances(self, tmp_path):
        db = tmp_path / "agent_state.db"
        worker_a = AgentStateStore(db)
        worker_b = AgentStateStore(db)
        # Submitted on worker A...
        worker_a.save_action(_make_action("xworker"))
        # ...visible on worker B (the multi-worker correctness guarantee).
        assert worker_b.get_action("xworker") is not None

    def test_in_memory_is_isolated_per_instance(self):
        store1 = AgentStateStore()
        store2 = AgentStateStore()
        store1.save_action(_make_action("only_in_1"))
        assert store1.get_action("only_in_1") is not None
        assert store2.get_action("only_in_1") is None
