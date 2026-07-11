"""Verified answers tests — store semantics (dedup, mode scoping), lexical
retrieval with hidden-table filtering, prompt block, API endpoints."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.semantic.verified_answers import VerifiedAnswersStore, few_shot_block


@pytest.fixture()
def store(tmp_path) -> VerifiedAnswersStore:
    return VerifiedAnswersStore(tmp_path / "va.db")


class TestStore:
    def test_add_list_delete_roundtrip(self, store):
        rec = store.add(
            "Top customers by revenue", "SELECT 1", verified_by="alice", mode="live"
        )
        assert store.list_answers("live")[0]["question"] == "Top customers by revenue"
        assert store.list_answers("demo") == []
        assert store.delete(rec["id"]) is True
        assert store.delete(rec["id"]) is False

    def test_same_question_replaces_previous(self, store):
        store.add("Top customers", "SELECT 1", "alice", "live")
        store.add("TOP CUSTOMERS", "SELECT 2", "bob", "live")
        rows = store.list_answers("live")
        assert len(rows) == 1
        assert rows[0]["sql"] == "SELECT 2" and rows[0]["verified_by"] == "bob"

    def test_same_question_different_mode_coexists(self, store):
        store.add("Top customers", "SELECT 1", "a", "live")
        store.add("Top customers", "SELECT 2", "a", "demo")
        assert (
            len(store.list_answers("live")) == 1
            and len(store.list_answers("demo")) == 1
        )


class TestRetrieval:
    def test_similar_question_matches_and_marks_used(self, store):
        rec = store.add(
            "Top 10 customers by total revenue", "SELECT c FROM t", "a", "live"
        )
        matches = store.find_similar("show top customers by revenue", "live")
        assert [m["id"] for m in matches] == [rec["id"]]
        block = few_shot_block(store, "show top customers by revenue", "live")
        assert "Verified examples" in block and "SELECT c FROM t" in block
        assert store.list_answers("live")[0]["use_count"] == 1

    def test_unrelated_question_no_match(self, store):
        store.add("Top customers by revenue", "SELECT 1", "a", "live")
        assert store.find_similar("average employee salary", "live") == []
        assert few_shot_block(store, "average employee salary", "live") == ""

    def test_mode_scoping(self, store):
        store.add("Top customers by revenue", "SELECT 1", "a", "demo")
        assert store.find_similar("top customers revenue", "live") == []

    def test_hidden_table_sql_never_leaks(self, store):
        store.add(
            "Top customers by revenue",
            'SELECT * FROM "sales_order_header" JOIN crm_accounts',
            "a",
            "live",
        )
        matches = store.find_similar(
            "top customers revenue",
            "live",
            hidden_tables=frozenset({"sales_order_header"}),
        )
        assert matches == []

    def test_italian_accents_fold(self, store):
        store.add("Quantità ordini per città", "SELECT 1", "a", "live")
        assert store.find_similar("quantita ordini citta", "live") != []


class TestEndpoints:
    @pytest.fixture()
    def client(self):
        def _hash(pw):
            salt = secrets.token_hex(16)
            digest = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 120_000)
            return f"pbkdf2_sha256$120000${salt}${base64.b64encode(digest).decode()}"

        os.environ["AUTH_USERS_JSON"] = json.dumps(
            [
                {
                    "username": "usr",
                    "password_hash": _hash("pw"),
                    "role": "user",
                    "disabled": False,
                },
                {
                    "username": "adm",
                    "password_hash": _hash("pw"),
                    "role": "admin",
                    "disabled": False,
                },
            ]
        )
        os.environ["JWT_SECRET_KEY"] = "verified-answers-test-secret-32b!!"
        os.environ["SEMANTIC_REQUIRE_LLM_INTENT"] = "0"

        import app.main as m
        from fastapi.testclient import TestClient

        limiter = getattr(m.app.state, "limiter", None)
        if limiter:
            limiter.enabled = False
        with TestClient(m.app) as c:
            headers = {}
            for u in ("usr", "adm"):
                r = c.post("/api/auth/token", data={"username": u, "password": "pw"})
                headers[u] = {"Authorization": f"Bearer {r.json()['access_token']}"}
            yield c, headers["usr"], headers["adm"]

    @pytest.fixture(autouse=True)
    def _isolated_store(self, tmp_path, monkeypatch):
        import app.semantic.verified_answers as va

        monkeypatch.setattr(
            va, "_default_store", VerifiedAnswersStore(tmp_path / "va.db")
        )

    def test_verify_list_delete_flow(self, client):
        c, user, admin = client
        r = c.post(
            "/api/semantic/answers/verify",
            json={
                "question": "How many orders in 2024?",
                "sql": "SELECT COUNT(*) FROM orders WHERE year = 2024",
            },
            headers=user,
        )
        assert r.status_code == 200
        answer_id = r.json()["id"]
        assert r.json()["verified_by"] == "usr"

        r = c.get("/api/semantic/answers", headers=user)
        assert r.status_code == 200 and len(r.json()) == 1

        # Delete is admin-only.
        assert (
            c.delete(f"/api/semantic/answers/{answer_id}", headers=user).status_code
            == 403
        )
        assert (
            c.delete(f"/api/semantic/answers/{answer_id}", headers=admin).status_code
            == 204
        )
        assert c.get("/api/semantic/answers", headers=user).json() == []

    def test_destructive_sql_rejected(self, client):
        c, user, _admin = client
        r = c.post(
            "/api/semantic/answers/verify",
            json={"question": "cleanup", "sql": "DROP TABLE orders"},
            headers=user,
        )
        assert r.status_code == 422

    def test_requires_auth(self, client):
        c, _user, _admin = client
        assert c.get("/api/semantic/answers").status_code == 401
        assert c.post("/api/semantic/answers/verify", json={}).status_code == 401
