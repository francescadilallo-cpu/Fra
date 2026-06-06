"""Unit tests for ContextManager — context/manager.py.

Covers: Context dataclass, get_or_create, update, remember/resolve,
list_sessions, drop_session, and LRU eviction.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent))

from app.context.manager import _MAX_HISTORY, _MAX_SESSIONS, Context, ContextManager


# ── Context dataclass ─────────────────────────────────────────────────────────


class TestContext:
    def test_initial_state(self):
        ctx = Context(session_id="abc", user="alice", role="admin")
        assert ctx.session_id == "abc"
        assert ctx.user == "alice"
        assert ctx.role == "admin"
        assert ctx.history == []
        assert ctx.resolved_entities == {}

    def test_add_history_appends_entry(self):
        ctx = Context(session_id="s1")
        ctx.add_history("intent_a", {"rows": 5})
        assert len(ctx.history) == 1
        assert ctx.history[0] == {"intent": "intent_a", "result": {"rows": 5}}

    def test_add_history_trims_to_max(self):
        ctx = Context(session_id="s1")
        for i in range(_MAX_HISTORY + 5):
            ctx.add_history(f"intent_{i}", f"result_{i}")
        assert len(ctx.history) == _MAX_HISTORY

    def test_add_history_keeps_most_recent(self):
        ctx = Context(session_id="s1")
        for i in range(_MAX_HISTORY + 3):
            ctx.add_history(f"intent_{i}", f"result_{i}")
        assert ctx.history[-1]["intent"] == f"intent_{_MAX_HISTORY + 2}"
        assert ctx.history[0]["intent"] == "intent_3"

    def test_add_history_exactly_at_max_does_not_trim(self):
        ctx = Context(session_id="s1")
        for i in range(_MAX_HISTORY):
            ctx.add_history(f"i{i}", f"r{i}")
        assert len(ctx.history) == _MAX_HISTORY


# ── ContextManager ────────────────────────────────────────────────────────────


class TestGetOrCreate:
    def test_creates_new_session(self):
        mgr = ContextManager()
        ctx = mgr.get_or_create("sess-1")
        assert ctx.session_id == "sess-1"
        assert ctx.user == "default"

    def test_returns_same_object_on_repeat(self):
        mgr = ContextManager()
        ctx1 = mgr.get_or_create("sess-x")
        ctx2 = mgr.get_or_create("sess-x")
        assert ctx1 is ctx2

    def test_none_session_id_generates_uuid(self):
        mgr = ContextManager()
        ctx = mgr.get_or_create(None)
        assert ctx.session_id is not None
        assert len(ctx.session_id) == 36  # UUID-4 canonical form

    def test_two_none_calls_yield_distinct_sessions(self):
        mgr = ContextManager()
        c1 = mgr.get_or_create(None)
        c2 = mgr.get_or_create(None)
        assert c1.session_id != c2.session_id

    def test_user_stored_on_create(self):
        mgr = ContextManager()
        ctx = mgr.get_or_create("sess-u", user="alice")
        assert ctx.user == "alice"

    def test_last_accessed_refreshed_on_retrieval(self):
        mgr = ContextManager()
        ctx = mgr.get_or_create("sess-la")
        t_before = ctx.last_accessed
        time.sleep(0.02)
        mgr.get_or_create("sess-la")
        assert ctx.last_accessed > t_before


class TestUpdate:
    def test_records_history_entry(self):
        mgr = ContextManager()
        mgr.get_or_create("sess-upd")
        mgr.update("sess-upd", "revenue_intent", {"total": 100})
        ctx = mgr.get_or_create("sess-upd")
        assert len(ctx.history) == 1
        assert ctx.history[0]["intent"] == "revenue_intent"

    def test_multiple_updates_accumulate(self):
        mgr = ContextManager()
        mgr.get_or_create("sess-multi")
        for i in range(3):
            mgr.update("sess-multi", f"intent_{i}", f"result_{i}")
        ctx = mgr.get_or_create("sess-multi")
        assert len(ctx.history) == 3

    def test_nonexistent_session_is_noop(self):
        mgr = ContextManager()
        # Must not raise
        mgr.update("ghost", "intent", "result")


class TestRememberAndResolve:
    def test_remember_then_resolve(self):
        mgr = ContextManager()
        mgr.get_or_create("sess-r")
        mgr.remember("sess-r", "fatturato", "revenue_with_tax")
        assert mgr.resolve("sess-r", "fatturato") == "revenue_with_tax"

    def test_resolve_unknown_term_returns_none(self):
        mgr = ContextManager()
        mgr.get_or_create("sess-r")
        assert mgr.resolve("sess-r", "unknown_term") is None

    def test_resolve_nonexistent_session_returns_none(self):
        mgr = ContextManager()
        assert mgr.resolve("ghost-sess", "term") is None

    def test_remember_nonexistent_session_is_noop(self):
        mgr = ContextManager()
        mgr.remember("ghost-sess", "term", "value")  # must not raise

    def test_multiple_resolutions_stored_independently(self):
        mgr = ContextManager()
        mgr.get_or_create("sess-m")
        mgr.remember("sess-m", "fatturato", "revenue_with_tax")
        mgr.remember("sess-m", "margine", "gross_margin")
        assert mgr.resolve("sess-m", "fatturato") == "revenue_with_tax"
        assert mgr.resolve("sess-m", "margine") == "gross_margin"

    def test_resolution_overwrite(self):
        mgr = ContextManager()
        mgr.get_or_create("sess-ow")
        mgr.remember("sess-ow", "term", "first")
        mgr.remember("sess-ow", "term", "second")
        assert mgr.resolve("sess-ow", "term") == "second"


class TestListAndDrop:
    def test_list_sessions_empty_on_new_manager(self):
        mgr = ContextManager()
        assert mgr.list_sessions() == []

    def test_list_sessions_includes_all_created(self):
        mgr = ContextManager()
        mgr.get_or_create("s1")
        mgr.get_or_create("s2")
        mgr.get_or_create("s3")
        assert set(mgr.list_sessions()) == {"s1", "s2", "s3"}

    def test_drop_existing_session_returns_true(self):
        mgr = ContextManager()
        mgr.get_or_create("s-drop")
        assert mgr.drop_session("s-drop") is True

    def test_drop_removes_from_store(self):
        mgr = ContextManager()
        mgr.get_or_create("s-drop")
        mgr.drop_session("s-drop")
        assert "s-drop" not in mgr.list_sessions()

    def test_drop_nonexistent_returns_false(self):
        mgr = ContextManager()
        assert mgr.drop_session("ghost") is False


class TestEviction:
    def test_eviction_triggered_at_capacity(self):
        mgr = ContextManager()
        # Fill to capacity, then force all to appear stale
        for i in range(_MAX_SESSIONS):
            ctx = mgr.get_or_create(f"old-{i}")
            ctx.last_accessed = float(i)  # oldest = 0, newest = _MAX_SESSIONS - 1

        # Creating one more triggers eviction of the oldest half
        mgr.get_or_create("trigger-evict")
        remaining = len(mgr.list_sessions())
        # After eviction: _MAX_SESSIONS - (_MAX_SESSIONS // 2) old + 1 new
        assert remaining <= _MAX_SESSIONS - (_MAX_SESSIONS // 2) + 1

    def test_eviction_removes_oldest(self):
        mgr = ContextManager()
        for i in range(_MAX_SESSIONS):
            ctx = mgr.get_or_create(f"old-{i}")
            ctx.last_accessed = float(i)

        mgr.get_or_create("new-one")
        sessions = set(mgr.list_sessions())
        # The oldest sessions (old-0, old-1, ...) should have been evicted
        assert "old-0" not in sessions
        assert "old-1" not in sessions

    def test_no_eviction_below_capacity(self):
        mgr = ContextManager()
        for i in range(10):
            mgr.get_or_create(f"sess-{i}")
        assert len(mgr.list_sessions()) == 10
