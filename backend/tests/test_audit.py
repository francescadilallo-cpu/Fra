"""Tests for the append-only audit trail — audit/store.py + /api/audit."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.audit.store import AuditStore


@pytest.fixture()
def store(tmp_path) -> AuditStore:
    return AuditStore(db_path=tmp_path / "test_audit.db")


class TestAuditStore:
    def test_log_and_list(self, store):
        store.log(
            "alice", "Added data source", "ERP (postgresql)", "10.0.0.1", "config"
        )
        entries = store.list()
        assert len(entries) == 1
        e = entries[0]
        assert e.username == "alice"
        assert e.action == "Added data source"
        assert e.resource == "ERP (postgresql)"
        assert e.ip == "10.0.0.1"
        assert e.category == "config"
        assert e.ts  # ISO timestamp present

    def test_list_empty(self, store):
        assert store.list() == []

    def test_newest_first(self, store):
        store.log("alice", "first")
        store.log("alice", "second")
        entries = store.list()
        assert [e.action for e in entries] == ["second", "first"]

    def test_invalid_category_coerced_to_config(self, store):
        store.log("alice", "weird", category="nonsense")
        assert store.list()[0].category == "config"

    def test_filter_by_category(self, store):
        store.log("alice", "login", category="auth")
        store.log("alice", "sync", category="data")
        assert [e.action for e in store.list(category="auth")] == ["login"]

    def test_search(self, store):
        store.log("alice", "Added data source", "Snowflake DWH")
        store.log("bob", "Logged in")
        hits = store.list(q="snowflake")
        assert len(hits) == 1
        assert hits[0].username == "alice"

    def test_limit_clamped(self, store):
        for i in range(5):
            store.log("alice", f"a{i}")
        assert len(store.list(limit=2)) == 2

    def test_long_values_truncated(self, store):
        store.log("u" * 500, "a" * 500, "r" * 500, "i" * 500)
        e = store.list()[0]
        assert len(e.username) == 120
        assert len(e.action) == 200
        assert len(e.resource) == 300
        assert len(e.ip) == 64

    def test_search_matches_resource(self, store):
        store.log("alice", "Sync", resource="Snowflake DWH", category="data")
        store.log("bob", "Login", resource="", category="auth")
        hits = store.list(q="snowflake")
        assert len(hits) == 1
        assert hits[0].username == "alice"

    def test_category_and_q_combined(self, store):
        store.log("alice", "Synced data", resource="ERP", category="data")
        store.log("alice", "Logged in", resource="", category="auth")
        store.log("bob", "Synced config", resource="", category="data")
        # Only the data-category entry whose fields contain "ERP"
        hits = store.list(category="data", q="ERP")
        assert len(hits) == 1
        assert hits[0].resource == "ERP"

    def test_invalid_category_filter_ignored(self, store):
        store.log("alice", "action", category="auth")
        # Invalid category filter → behaves as if no filter
        all_results = store.list()
        filtered = store.list(category="bogus")
        assert len(filtered) == len(all_results)

    def test_limit_min_one(self, store):
        for i in range(5):
            store.log("alice", f"a{i}")
        assert len(store.list(limit=0)) == 1  # clamped to 1
        assert len(store.list(limit=-5)) == 1  # clamped to 1


class TestAuditEndpoint:
    """Endpoint smoke tests reuse the integration-test app fixtures."""

    @pytest.fixture(scope="class")
    def client(self, tmp_path_factory):
        import base64
        import hashlib
        import json
        import os
        import secrets

        pw_salt = secrets.token_hex(16)
        digest = hashlib.pbkdf2_hmac("sha256", b"admin_pw", pw_salt.encode(), 120_000)
        users = [
            {
                "username": "audit_admin",
                "password_hash": f"pbkdf2_sha256$120000${pw_salt}${base64.b64encode(digest).decode()}",
                "role": "admin",
                "disabled": False,
            }
        ]
        os.environ["AUTH_USERS_JSON"] = json.dumps(users)
        os.environ["JWT_SECRET_KEY"] = "audit-test-secret-key-32-chars!!!"

        import app.main as m

        limiter = getattr(m.app.state, "limiter", None)
        if limiter:
            limiter.enabled = False

        from fastapi.testclient import TestClient

        with TestClient(m.app) as c:
            yield c

    @pytest.fixture(scope="class")
    def headers(self, client):
        resp = client.post(
            "/api/auth/token",
            data={"username": "audit_admin", "password": "admin_pw"},
        )
        assert resp.status_code == 200, resp.text
        return {"Authorization": f"Bearer {resp.json()['access_token']}"}

    def test_requires_auth(self, client):
        assert client.get("/api/audit").status_code == 401

    def test_login_is_audited(self, client, headers):
        resp = client.get("/api/audit", headers=headers, params={"category": "auth"})
        assert resp.status_code == 200
        entries = resp.json()
        # The login that produced `headers` must be in the trail
        assert any(
            e["username"] == "audit_admin" and e["action"] == "Logged in"
            for e in entries
        )

    def test_list_shape(self, client, headers):
        resp = client.get("/api/audit", headers=headers, params={"limit": 5})
        assert resp.status_code == 200
        for e in resp.json():
            assert set(e) == {
                "id",
                "ts",
                "username",
                "action",
                "resource",
                "ip",
                "category",
            }

    def test_q_filter_returns_matching_entries(self, client, headers):
        resp = client.get("/api/audit", headers=headers, params={"q": "audit_admin"})
        assert resp.status_code == 200
        entries = resp.json()
        assert all(
            "audit_admin" in (e["username"] + e["action"] + e["resource"]).lower()
            for e in entries
        )

    def test_limit_out_of_range_422(self, client, headers):
        resp = client.get("/api/audit", headers=headers, params={"limit": 9999})
        assert resp.status_code == 422

    def test_q_too_long_422(self, client, headers):
        resp = client.get("/api/audit", headers=headers, params={"q": "x" * 121})
        assert resp.status_code == 422
