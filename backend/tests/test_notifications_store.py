"""Tests for notifications store (app/notifications/store.py)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.notifications.store import NotificationsStore


@pytest.fixture()
def store(tmp_path) -> NotificationsStore:
    return NotificationsStore(db_path=tmp_path / "test_notif.db")


class TestChannels:
    def test_empty_on_init(self, store):
        assert store.list_channels() == []

    def test_add_and_list(self, store):
        ch = store.add_channel("ops-alerts", "slack", "https://hooks.slack.com/x")
        channels = store.list_channels()
        assert len(channels) == 1
        assert channels[0].name == "ops-alerts"
        assert channels[0].channel_type == "slack"
        assert channels[0].enabled is True
        assert ch.id == channels[0].id

    def test_invalid_type_coerced_to_webhook(self, store):
        store.add_channel("x", "unknown_type", "https://x.com")
        assert store.list_channels()[0].channel_type == "webhook"

    def test_update_enabled(self, store):
        ch = store.add_channel("c", "email", "ops@x.com")
        ok = store.update_channel(ch.id, enabled=False)
        assert ok
        assert store.list_channels()[0].enabled is False

    def test_update_name(self, store):
        ch = store.add_channel("old", "teams", "https://t.com")
        store.update_channel(ch.id, name="new")
        assert store.list_channels()[0].name == "new"

    def test_update_name_and_enabled_together(self, store):
        ch = store.add_channel("orig", "slack", "https://s.com")
        store.update_channel(ch.id, name="renamed", enabled=False)
        updated = store.list_channels()[0]
        assert updated.name == "renamed"
        assert updated.enabled is False

    def test_update_no_fields_returns_true(self, store):
        ch = store.add_channel("x", "webhook", "https://x.com")
        assert store.update_channel(ch.id) is True

    def test_update_nonexistent_returns_false(self, store):
        assert not store.update_channel("does-not-exist", enabled=True)

    def test_remove_channel(self, store):
        ch = store.add_channel("d", "webhook", "https://d.com")
        ok = store.remove_channel(ch.id)
        assert ok
        assert store.list_channels() == []

    def test_remove_nonexistent_returns_false(self, store):
        assert not store.remove_channel("no-such-id")


class TestRouting:
    def test_default_routing_empty(self, store):
        r = store.get_routing()
        assert r == {"critical": [], "warning": [], "info": []}

    def test_update_and_get_routing(self, store):
        store.update_routing({"critical": ["c1", "c2"], "warning": ["c1"], "info": []})
        r = store.get_routing()
        assert r["critical"] == ["c1", "c2"]
        assert r["warning"] == ["c1"]
        assert r["info"] == []

    def test_update_routing_idempotent(self, store):
        store.update_routing({"critical": ["c1"], "warning": [], "info": []})
        store.update_routing({"critical": ["c2"], "warning": ["c2"], "info": []})
        r = store.get_routing()
        assert r["critical"] == ["c2"]
        assert r["warning"] == ["c2"]
