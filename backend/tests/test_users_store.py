"""Tests for workspace member store (app/users/store.py)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.users.store import UsersStore


@pytest.fixture()
def store(tmp_path) -> UsersStore:
    return UsersStore(db_path=tmp_path / "test_users.db")


class TestUsersStore:
    def test_empty_on_init(self, store):
        assert store.list_members() == []

    def test_add_and_list(self, store):
        m = store.add_member(email="alice@example.com", role="editor")
        members = store.list_members()
        assert len(members) == 1
        assert members[0].email == "alice@example.com"
        assert members[0].role == "editor"
        assert members[0].status == "pending"
        assert m.id == members[0].id

    def test_username_derived_from_email(self, store):
        store.add_member(email="john.doe@corp.ai")
        assert store.list_members()[0].username == "john.doe"

    def test_invalid_role_coerced_to_editor(self, store):
        store.add_member(email="x@y.com", role="superadmin")
        assert store.list_members()[0].role == "editor"

    def test_duplicate_email_ignored(self, store):
        store.add_member(email="dup@ex.com")
        store.add_member(email="dup@ex.com")
        assert len(store.list_members()) == 1

    def test_duplicate_email_returns_existing_record(self, store):
        m1 = store.add_member(email="dup2@ex.com")
        m2 = store.add_member(email="dup2@ex.com")
        assert m1.id == m2.id  # same record, not a phantom new id

    def test_update_role(self, store):
        m = store.add_member(email="b@ex.com", role="viewer")
        ok = store.update_role(m.id, "admin")
        assert ok
        assert store.list_members()[0].role == "admin"

    def test_update_role_invalid_returns_false(self, store):
        m = store.add_member(email="c@ex.com")
        ok = store.update_role(m.id, "superuser")
        assert not ok

    def test_remove_member(self, store):
        m = store.add_member(email="d@ex.com")
        ok = store.remove_member(m.id)
        assert ok
        assert store.list_members() == []

    def test_remove_nonexistent_returns_false(self, store):
        assert not store.remove_member("does-not-exist")

    def test_long_email_truncated(self, store):
        store.add_member(email="a" * 300 + "@b.com")
        m = store.list_members()[0]
        assert len(m.email) <= 200
