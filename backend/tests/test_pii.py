"""PII masking tests — strategies, rule scoping, name-based suggestions,
API endpoints, and end-to-end masking through /api/data and /api/ask."""

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

from app.semantic.pii import (
    PiiRulesStore,
    mask_rows,
    mask_value,
    suggest_rules,
)


@pytest.fixture()
def store(tmp_path) -> PiiRulesStore:
    return PiiRulesStore(tmp_path / "pii.db")


class TestMaskValue:
    def test_full_hides_everything(self):
        assert mask_value("RSSMRA80A01H501U", "full") == "•••••"

    def test_partial_keeps_last_four(self):
        assert mask_value("+39 333 1234567", "partial").endswith("4567")
        assert "333" not in mask_value("+39 333 1234567", "partial")
        assert mask_value("abc", "partial") == "•••••"

    def test_email_keeps_first_char_and_domain(self):
        masked = mask_value("mario.rossi@example.com", "email")
        assert masked == "m•••@example.com"
        # Non-email value with email strategy degrades to full mask.
        assert mask_value("not-an-email", "email") == "•••••"

    def test_none_stays_none(self):
        assert mask_value(None, "full") is None


class TestMaskRows:
    def _rules(self):
        return [
            {"table": "", "column": "email", "strategy": "email"},
            {"table": "pazienti", "column": "codice_fiscale", "strategy": "full"},
        ]

    def test_global_rule_masks_everywhere(self):
        rows = [{"name": "Mario", "EMAIL": "m@x.it"}]
        masked, cols = mask_rows(rows, self._rules(), tables=["anything"])
        assert masked[0]["EMAIL"] == "m•••@x.it"
        assert masked[0]["name"] == "Mario"
        assert cols == ["EMAIL"]

    def test_table_scoped_rule_only_applies_to_its_table(self):
        rows = [{"codice_fiscale": "RSSMRA80A01H501U"}]
        masked, cols = mask_rows(rows, self._rules(), tables=["pazienti"])
        assert masked[0]["codice_fiscale"] == "•••••"
        untouched, cols2 = mask_rows(rows, self._rules(), tables=["orders"])
        assert untouched[0]["codice_fiscale"] == "RSSMRA80A01H501U" and cols2 == []

    def test_original_rows_not_mutated(self):
        rows = [{"email": "m@x.it"}]
        mask_rows(rows, self._rules())
        assert rows[0]["email"] == "m@x.it"


class TestStoreAndSuggestions:
    def test_add_replaces_same_column(self, store):
        store.add("email", "full")
        store.add("EMAIL", "email")
        rules = store.list_rules()
        assert len(rules) == 1 and rules[0]["strategy"] == "email"

    def test_suggestions_from_names_only(self, store):
        schema = {
            "pazienti": {
                "columns": [
                    {"name": "id"},
                    {"name": "codice_fiscale"},
                    {"name": "email"},
                    {"name": "telefono"},
                ]
            },
            "orders": {"columns": [{"name": "total"}, {"name": "iban"}]},
        }
        got = suggest_rules(schema, existing=[])
        by_col = {(s["table"], s["column"]): s["strategy"] for s in got}
        assert by_col[("pazienti", "codice_fiscale")] == "full"
        assert by_col[("pazienti", "email")] == "email"
        assert by_col[("pazienti", "telefono")] == "partial"
        assert by_col[("orders", "iban")] == "partial"
        assert ("pazienti", "id") not in by_col

    def test_suggestions_skip_covered_columns(self, store):
        schema = {"t": {"columns": [{"name": "email"}, {"name": "iban"}]}}
        existing = [{"table": "", "column": "email", "strategy": "email"}]
        got = suggest_rules(schema, existing)
        assert [s["column"] for s in got] == ["iban"]


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
        os.environ["JWT_SECRET_KEY"] = "pii-endpoints-test-secret-32bytes!!"
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
        import app.semantic.pii as pii

        monkeypatch.setattr(pii, "_default_store", PiiRulesStore(tmp_path / "p.db"))

    def test_rule_crud_admin_only(self, client):
        c, user, admin = client
        rule = {"column": "email", "strategy": "email"}
        assert (
            c.post("/api/semantic/pii/rules", json=rule, headers=user).status_code
            == 403
        )
        r = c.post("/api/semantic/pii/rules", json=rule, headers=admin)
        assert r.status_code == 201
        rule_id = r.json()["id"]

        # Everyone can see which columns are protected.
        assert len(c.get("/api/semantic/pii/rules", headers=user).json()) == 1

        assert (
            c.delete(f"/api/semantic/pii/rules/{rule_id}", headers=admin).status_code
            == 204
        )
        assert c.get("/api/semantic/pii/rules", headers=user).json() == []

    def test_scan_returns_suggestions(self, client):
        c, _user, admin = client
        r = c.post("/api/semantic/pii/scan", headers=admin)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_data_dump_is_masked(self, client):
        c, _user, admin = client
        # "customers" is a legacy demo table always present in the test env
        # (same fixture used by the pagination integration tests).
        r = c.get("/api/data/customers?page_size=1", headers=admin)
        if r.status_code != 200 or not r.json()["data"]:
            pytest.skip("demo table not available in this environment")
        row = r.json()["data"][0]
        # Protect a column that actually carries a value.
        target_col = next((k for k, v in row.items() if v is not None), next(iter(row)))
        assert (
            c.post(
                "/api/semantic/pii/rules",
                json={"column": target_col, "strategy": "full"},
                headers=admin,
            ).status_code
            == 201
        )
        masked_row = c.get("/api/data/customers?page_size=1", headers=admin).json()[
            "data"
        ][0]
        assert masked_row[target_col] in ("•••••", None)

    def test_invalid_strategy_rejected(self, client):
        c, _user, admin = client
        r = c.post(
            "/api/semantic/pii/rules",
            json={"column": "x", "strategy": "rot13"},
            headers=admin,
        )
        assert r.status_code == 422
