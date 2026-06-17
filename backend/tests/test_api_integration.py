"""Integration tests for main API routes.

These tests spin up the real FastAPI app with TestClient and exercise the
actual database layer (using the existing erp_mock.db and in-memory SQLite).
They catch routing bugs, missing auth guards, serialization errors, and
contract regressions that unit tests cannot.
"""

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


# ── Shared fixtures ────────────────────────────────────────────────────────────


def _hash_pw(pw: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 120_000)
    return f"pbkdf2_sha256$120000${salt}${base64.b64encode(digest).decode()}"


@pytest.fixture(scope="module")
def _env():
    users = [
        {
            "username": "admin_u",
            "password_hash": _hash_pw("admin_pw"),
            "role": "admin",
            "disabled": False,
        },
        {
            "username": "user_u",
            "password_hash": _hash_pw("user_pw"),
            "role": "user",
            "disabled": False,
        },
    ]
    os.environ["AUTH_USERS_JSON"] = json.dumps(users)
    os.environ["JWT_SECRET_KEY"] = "integration-test-secret-key-32chars!!"
    os.environ["SEMANTIC_REQUIRE_LLM_INTENT"] = "0"


@pytest.fixture(scope="module")
def client(_env):
    import app.main as m

    limiter = getattr(m.app.state, "limiter", None)
    if limiter:
        limiter.enabled = False

    from fastapi.testclient import TestClient

    with TestClient(m.app) as c:
        yield c


@pytest.fixture(scope="module")
def user_headers(client):
    resp = client.post(
        "/api/auth/token", data={"username": "user_u", "password": "user_pw"}
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.fixture(scope="module")
def admin_headers(client):
    resp = client.post(
        "/api/auth/token", data={"username": "admin_u", "password": "admin_pw"}
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


# ── Health ─────────────────────────────────────────────────────────────────────


def test_health_is_public(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


# ── Auth ───────────────────────────────────────────────────────────────────────


def test_login_returns_token(client):
    resp = client.post(
        "/api/auth/token", data={"username": "user_u", "password": "user_pw"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["role"] == "user"


def test_login_wrong_password_401(client):
    resp = client.post(
        "/api/auth/token", data={"username": "user_u", "password": "wrong"}
    )
    assert resp.status_code == 401


def test_login_unknown_user_401(client):
    resp = client.post("/api/auth/token", data={"username": "nobody", "password": "pw"})
    assert resp.status_code == 401


# ── Dashboard ──────────────────────────────────────────────────────────────────


def test_dashboard_requires_auth(client):
    resp = client.get("/api/dashboard")
    assert resp.status_code == 401


def test_dashboard_returns_data(client, user_headers):
    resp = client.get("/api/dashboard", headers=user_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "total_customers" in data
    assert "total_orders" in data
    assert "total_products" in data
    assert "total_quotes" in data
    assert isinstance(data["recent_orders"], list)
    assert isinstance(data["data_sources"], list)
    assert 0.0 <= data["quote_conversion_rate"] <= 100.0


# ── Ontology ───────────────────────────────────────────────────────────────────


def test_ontology_graph_requires_auth(client):
    resp = client.get("/api/ontology/graph")
    assert resp.status_code == 401


def test_ontology_graph_returns_graph(client, user_headers):
    resp = client.get("/api/ontology/graph", headers=user_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "nodes" in data
    assert "edges" in data
    assert isinstance(data["nodes"], list)
    assert isinstance(data["edges"], list)


def test_ontology_mappings_requires_auth(client):
    resp = client.get("/api/ontology/mappings")
    assert resp.status_code == 401


def test_ontology_mappings_returns_list(client, user_headers):
    resp = client.get("/api/ontology/mappings", headers=user_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "mappings" in data
    assert isinstance(data["mappings"], list)
    assert len(data["mappings"]) > 0
    first = data["mappings"][0]
    assert "table" in first
    assert "field" in first
    assert "ontology_class" in first


def test_ontology_mapping_update_admin_only(client, user_headers):
    payload = {
        "table": "customers",
        "field": "name",
        "ontology_path": "Customer.fullName",
    }
    resp = client.put("/api/ontology/mappings", json=payload, headers=user_headers)
    assert resp.status_code == 403


def test_ontology_mapping_update_admin_succeeds(client, admin_headers):
    payload = {"table": "customers", "field": "name", "ontology_path": "Customer.name"}
    resp = client.put("/api/ontology/mappings", json=payload, headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["success"] is True


def test_ontology_mapping_update_unknown_table_404(client, admin_headers):
    payload = {"table": "nonexistent", "field": "name", "ontology_path": "X.y"}
    resp = client.put("/api/ontology/mappings", json=payload, headers=admin_headers)
    assert resp.status_code == 404


# ── Data table pagination ──────────────────────────────────────────────────────


@pytest.mark.parametrize("table", ["customers", "products", "quotes", "orders"])
def test_table_data_requires_auth(client, table):
    resp = client.get(f"/api/data/{table}")
    assert resp.status_code == 401


@pytest.mark.parametrize("table", ["customers", "products", "quotes", "orders"])
def test_table_data_returns_paginated(client, user_headers, table):
    resp = client.get(
        f"/api/data/{table}", headers=user_headers, params={"page": 1, "page_size": 5}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["table"] == table
    assert data["page"] == 1
    assert data["page_size"] == 5
    assert isinstance(data["data"], list)
    assert len(data["data"]) <= 5
    assert data["total"] >= 0


def test_table_data_unknown_table_404(client, user_headers):
    resp = client.get("/api/data/nonexistent", headers=user_headers)
    assert resp.status_code == 404


def test_table_data_page_size_capped_at_100(client, user_headers):
    resp = client.get(
        "/api/data/customers", headers=user_headers, params={"page_size": 999}
    )
    assert resp.status_code == 422  # FastAPI validates ge/le on Query


def test_table_data_page_zero_422(client, user_headers):
    resp = client.get("/api/data/customers", headers=user_headers, params={"page": 0})
    assert resp.status_code == 422


# ── Semantic CRUD — Metrics ────────────────────────────────────────────────────


_METRIC_PAYLOAD = {
    "sector_id": "manufacturing",
    "name": "Test Revenue",
    "description": "Integration test metric",
    "type": "sum",
    "entity": "SalesOrder",
    "field": "total_due",
    "numerator": "",
    "denominator": "",
    "expression": "",
    "filters": [],
    "time_dimension": "",
    "grains": ["month", "year"],
    "format": "currency",
    "status": "draft",
    "owner": "QA",
    "tags": ["test"],
}


def test_create_metric_requires_admin(client, user_headers):
    resp = client.post(
        "/api/semantic/metrics", json=_METRIC_PAYLOAD, headers=user_headers
    )
    assert resp.status_code == 403


def test_metrics_crud_lifecycle(client, admin_headers, user_headers):
    # Create
    resp = client.post(
        "/api/semantic/metrics", json=_METRIC_PAYLOAD, headers=admin_headers
    )
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "Test Revenue"
    mid = created["id"]
    assert mid.startswith("m-")

    # List — user can read
    resp = client.get("/api/semantic/metrics", headers=user_headers)
    assert resp.status_code == 200
    ids = [m["id"] for m in resp.json()]
    assert mid in ids

    # Delete — user cannot
    resp = client.delete(f"/api/semantic/metrics/{mid}", headers=user_headers)
    assert resp.status_code == 403

    # Delete — admin can
    resp = client.delete(f"/api/semantic/metrics/{mid}", headers=admin_headers)
    assert resp.status_code == 204

    # Confirm gone
    resp = client.get("/api/semantic/metrics", headers=user_headers)
    assert mid not in [m["id"] for m in resp.json()]


def test_create_metric_invalid_type_422(client, admin_headers):
    bad = {**_METRIC_PAYLOAD, "type": "not_a_valid_type"}
    resp = client.post("/api/semantic/metrics", json=bad, headers=admin_headers)
    assert resp.status_code == 422


def test_create_metric_name_too_long_422(client, admin_headers):
    bad = {**_METRIC_PAYLOAD, "name": "x" * 129}
    resp = client.post("/api/semantic/metrics", json=bad, headers=admin_headers)
    assert resp.status_code == 422


# ── Semantic CRUD — Hierarchies ────────────────────────────────────────────────


_HIERARCHY_PAYLOAD = {
    "sector_id": "manufacturing",
    "name": "Test Hierarchy",
    "entity": "SalesOrder",
    "description": "Integration test hierarchy",
    "type": "categorical",
    "levels": [{"name": "Top", "field": "territory_ref"}],
}


def test_hierarchy_crud_lifecycle(client, admin_headers, user_headers):
    resp = client.post(
        "/api/semantic/hierarchies", json=_HIERARCHY_PAYLOAD, headers=admin_headers
    )
    assert resp.status_code == 201, resp.text
    created = resp.json()
    hid = created["id"]
    assert hid.startswith("h-")
    assert created["levels"] == [{"name": "Top", "field": "territory_ref"}]

    # Verify list
    resp = client.get("/api/semantic/hierarchies", headers=user_headers)
    assert hid in [h["id"] for h in resp.json()]

    # Cleanup
    resp = client.delete(f"/api/semantic/hierarchies/{hid}", headers=admin_headers)
    assert resp.status_code == 204


def test_hierarchy_invalid_type_422(client, admin_headers):
    bad = {**_HIERARCHY_PAYLOAD, "type": "invalid"}
    resp = client.post("/api/semantic/hierarchies", json=bad, headers=admin_headers)
    assert resp.status_code == 422


# ── Semantic CRUD — Segments ───────────────────────────────────────────────────


_SEGMENT_PAYLOAD = {
    "sector_id": "manufacturing",
    "name": "Test Segment",
    "description": "Integration test segment",
    "entity": "SalesOrder",
    "conditions": [{"field": "total_due", "operator": ">=", "value": "1000"}],
    "tags": ["test"],
    "used_by": [],
}


def test_segment_crud_lifecycle(client, admin_headers, user_headers):
    resp = client.post(
        "/api/semantic/segments", json=_SEGMENT_PAYLOAD, headers=admin_headers
    )
    assert resp.status_code == 201, resp.text
    created = resp.json()
    sid = created["id"]
    assert sid.startswith("seg-")

    # List
    resp = client.get("/api/semantic/segments", headers=user_headers)
    assert sid in [s["id"] for s in resp.json()]

    # Cleanup
    resp = client.delete(f"/api/semantic/segments/{sid}", headers=admin_headers)
    assert resp.status_code == 204


# ── Semantic coverage ──────────────────────────────────────────────────────────


def test_semantic_coverage_returns_breakdown(client, user_headers):
    resp = client.get("/api/semantic/coverage", headers=user_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "score" in data
    assert "breakdown" in data
    assert 0 <= data["score"] <= 100


# ── Context endpoints ──────────────────────────────────────────────────────────


def test_context_documents_lifecycle(client, user_headers):
    # List (should be empty or have docs)
    resp = client.get("/api/context/documents", headers=user_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_context_entity_crud(client, user_headers):
    # Create
    resp = client.post(
        "/api/context/entities",
        json={
            "name": "test_entity",
            "display_name": "Test Entity",
            "description": "IT test",
        },
        headers=user_headers,
    )
    assert resp.status_code == 201, resp.text
    eid = resp.json()["id"]

    # List
    resp = client.get("/api/context/entities", headers=user_headers)
    assert eid in [e["id"] for e in resp.json()]

    # Delete
    resp = client.delete(f"/api/context/entities/{eid}", headers=user_headers)
    assert resp.status_code == 204


def test_context_metric_crud(client, user_headers):
    # Create
    resp = client.post(
        "/api/context/metrics",
        json={"name": "test_revenue", "display_name": "Test Revenue", "unit": "EUR"},
        headers=user_headers,
    )
    assert resp.status_code == 201, resp.text
    mid = resp.json()["id"]

    # List
    resp = client.get("/api/context/metrics", headers=user_headers)
    assert mid in [m["id"] for m in resp.json()]

    # Delete
    resp = client.delete(f"/api/context/metrics/{mid}", headers=user_headers)
    assert resp.status_code == 204


def test_context_glossary_crud(client, user_headers):
    # Create
    resp = client.post(
        "/api/context/glossary",
        json={"term": "fatturato_test", "definition": "Test revenue term"},
        headers=user_headers,
    )
    assert resp.status_code == 201, resp.text
    gid = resp.json()["id"]

    # List
    resp = client.get("/api/context/glossary", headers=user_headers)
    assert any(g["id"] == gid for g in resp.json())

    # Delete
    resp = client.delete(f"/api/context/glossary/{gid}", headers=user_headers)
    assert resp.status_code == 204


def test_context_search_returns_snippets(client, user_headers):
    resp = client.get(
        "/api/context/search", headers=user_headers, params={"q": "revenue"}
    )
    assert resp.status_code == 200
    assert "snippets" in resp.json()


def test_context_search_empty_q_422(client, user_headers):
    resp = client.get("/api/context/search", headers=user_headers, params={"q": ""})
    assert resp.status_code == 422


def test_context_upload_too_large_413(client, user_headers):
    big = b"x" * (3 * 1024 * 1024)  # 3 MB > 2 MB limit
    resp = client.post(
        "/api/context/upload",
        headers=user_headers,
        files={"file": ("big.txt", big, "text/plain")},
    )
    assert resp.status_code == 413


def test_context_upload_bad_extension_422(client, user_headers):
    resp = client.post(
        "/api/context/upload",
        headers=user_headers,
        files={"file": ("data.csv", b"a,b,c", "text/csv")},
    )
    assert resp.status_code == 422


def test_context_upload_valid_txt(client, user_headers):
    resp = client.post(
        "/api/context/upload",
        headers=user_headers,
        files={"file": ("test_doc.txt", b"This is a test document.", "text/plain")},
    )
    assert resp.status_code == 200, resp.text
    doc = resp.json()
    assert doc["filename"] == "test_doc.txt"
    doc_id = doc["id"]

    # Cleanup
    resp = client.delete(f"/api/context/documents/{doc_id}", headers=user_headers)
    assert resp.status_code == 204


def test_context_delete_nonexistent_entity_404(client, user_headers):
    resp = client.delete("/api/context/entities/99999999", headers=user_headers)
    assert resp.status_code == 404


def test_context_delete_nonexistent_metric_404(client, user_headers):
    resp = client.delete("/api/context/metrics/99999999", headers=user_headers)
    assert resp.status_code == 404


def test_context_delete_nonexistent_glossary_term_404(client, user_headers):
    resp = client.delete("/api/context/glossary/99999999", headers=user_headers)
    assert resp.status_code == 404


def test_context_delete_nonexistent_document_404(client, user_headers):
    resp = client.delete("/api/context/documents/99999999", headers=user_headers)
    assert resp.status_code == 404


def test_context_create_entity_db_error_returns_503(client, user_headers, monkeypatch):
    import sqlite3

    from app.context import store as context_store_mod

    def _boom(*_a, **_k):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(context_store_mod.default_store, "add_entity", _boom)
    resp = client.post(
        "/api/context/entities",
        json={"name": "locked", "display_name": "Locked"},
        headers=user_headers,
    )
    assert resp.status_code == 503


# ── Input validation edge cases ────────────────────────────────────────────────


def test_metric_sector_id_too_long_422(client, admin_headers):
    bad = {**_METRIC_PAYLOAD, "sector_id": "x" * 65}
    resp = client.post("/api/semantic/metrics", json=bad, headers=admin_headers)
    assert resp.status_code == 422


def test_metric_tags_list_too_long_422(client, admin_headers):
    bad = {**_METRIC_PAYLOAD, "tags": [f"tag{i}" for i in range(21)]}
    resp = client.post("/api/semantic/metrics", json=bad, headers=admin_headers)
    assert resp.status_code == 422


def test_segment_name_empty_422(client, admin_headers):
    bad = {**_SEGMENT_PAYLOAD, "name": ""}
    resp = client.post("/api/semantic/segments", json=bad, headers=admin_headers)
    assert resp.status_code == 422


# ── Disabled-user auth bypass guard ───────────────────────────────────────────


def test_disabled_user_token_rejected(client):
    """A JWT issued before a user is disabled must be rejected on subsequent requests."""
    import base64
    import hashlib
    import json
    import os
    import secrets

    def _hash(pw):
        salt = secrets.token_hex(16)
        digest = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 120_000)
        return f"pbkdf2_sha256$120000${salt}${base64.b64encode(digest).decode()}"

    # Create a fresh user and log in to obtain a valid token
    users_with_disabled = [
        {
            "username": "admin_u",
            "password_hash": os.environ.get("_TEST_ADMIN_HASH", _hash("admin_pw")),
            "role": "admin",
            "disabled": False,
        },
        {
            "username": "user_u",
            "password_hash": os.environ.get("_TEST_USER_HASH", _hash("user_pw")),
            "role": "user",
            "disabled": False,
        },
        {
            "username": "will_be_disabled",
            "password_hash": _hash("secret123"),
            "role": "user",
            "disabled": False,
        },
    ]
    os.environ["AUTH_USERS_JSON"] = json.dumps(users_with_disabled)

    # Obtain a token while the account is still enabled
    resp = client.post(
        "/api/auth/token",
        data={"username": "will_be_disabled", "password": "secret123"},
    )
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    live_headers = {"Authorization": f"Bearer {token}"}

    # Confirm the token works
    resp = client.get("/api/health")
    assert resp.status_code == 200
    resp = client.get("/api/dashboard", headers=live_headers)
    assert resp.status_code == 200

    # Now disable the user by updating AUTH_USERS_JSON
    users_with_disabled[-1]["disabled"] = True
    os.environ["AUTH_USERS_JSON"] = json.dumps(users_with_disabled)

    # The previously valid token must now be rejected
    resp = client.get("/api/dashboard", headers=live_headers)
    assert resp.status_code == 401, (
        "Disabled user should not be able to use an existing token"
    )

    # Restore original env for other tests
    original_users = [
        {
            "username": "admin_u",
            "password_hash": _hash("admin_pw"),
            "role": "admin",
            "disabled": False,
        },
        {
            "username": "user_u",
            "password_hash": _hash("user_pw"),
            "role": "user",
            "disabled": False,
        },
    ]
    os.environ["AUTH_USERS_JSON"] = json.dumps(original_users)


# ── SemanticAskRequest context dict size limit ─────────────────────────────────


def test_ask_oversized_context_422(client, user_headers):
    """SemanticAskRequest.context dict with >32 keys must be rejected with 422."""
    resp = client.post(
        "/api/semantic/ask",
        json={
            "question": "test",
            "context": {f"key_{i}": "val" for i in range(33)},
        },
        headers=user_headers,
    )
    assert resp.status_code == 422


# ── POST /api/sources — id collision guard ────────────────────────────────────
#
# add_source() lets the caller pick an arbitrary "id" via params["id"].
# SourceRegistry.upsert() is INSERT OR REPLACE — a colliding id would
# silently overwrite an existing source's connector config *and* its
# is_default flag (SourceConfig.is_default defaults to False on the new
# config), stripping "cannot remove default source" protection from one of
# the four baked-in seed sources (erp/crm/hr/pim) and leaving it deletable —
# permanently, since _seed_defaults() only reseeds an *empty* registry.
# Registration must refuse to clobber an id that already exists.


def test_add_source_with_colliding_id_is_rejected(client, admin_headers):
    import uuid

    # Unique per run — the registry is a persistent, file-backed singleton
    # shared across test runs, so a fixed id could collide with leftover
    # state from a previous (e.g. failed) run.
    source_id = f"collision-probe-{uuid.uuid4().hex[:12]}"
    try:
        first = client.post(
            "/api/sources",
            json={
                "connector_type": "shopify",
                "label": "Original label",
                "params": {"id": source_id},
            },
            headers=admin_headers,
        )
        assert first.status_code == 201, first.text

        second = client.post(
            "/api/sources",
            json={
                "connector_type": "shopify",
                "label": "Hijacked label",
                "params": {"id": source_id, "shop": "evil.example.com"},
            },
            headers=admin_headers,
        )
        assert second.status_code == 409, second.text

        # The original source must be untouched — no silent overwrite.
        listing = client.get("/api/sources", headers=admin_headers)
        assert listing.status_code == 200, listing.text
        match = next(s for s in listing.json() if s["id"] == source_id)
        assert match["label"] == "Original label"
        assert match["connector_type"] == "shopify"
    finally:
        client.delete(f"/api/sources/{source_id}", headers=admin_headers)


def test_add_source_cannot_hijack_a_protected_default_source(client, admin_headers):
    """The guard must cover the four baked-in default sources — the
    highest-value target, since overwriting one strips its is_default flag
    and makes an otherwise-protected source permanently deletable."""
    listing = client.get("/api/sources", headers=admin_headers)
    assert listing.status_code == 200, listing.text
    defaults = [s for s in listing.json() if s["is_default"]]
    if not defaults:
        pytest.skip("no protected default sources seeded in this environment")
    target = defaults[0]

    resp = client.post(
        "/api/sources",
        json={
            "connector_type": "shopify",
            "label": "Hijacked",
            "params": {"id": target["id"]},
        },
        headers=admin_headers,
    )
    assert resp.status_code == 409, resp.text

    listing_after = client.get("/api/sources", headers=admin_headers)
    match = next(s for s in listing_after.json() if s["id"] == target["id"])
    assert match["is_default"] is True
    assert match["connector_type"] == target["connector_type"]


# ── Demo vs live mode source visibility ───────────────────────────────────────
# Live-mode users get a from-scratch workspace: sources flagged is_default=True
# (the pre-seeded demo scenario) must be hidden from /api/sources, while
# demo-mode users see everything. The JWT carries the mode chosen at login.


def test_live_mode_hides_default_demo_sources(client):
    import uuid

    from app.connectors.source_registry import SourceConfig, get_source_registry

    registry = get_source_registry()
    probe_id = f"demo-visibility-probe-{uuid.uuid4().hex[:12]}"
    registry.upsert(
        SourceConfig(
            id=probe_id,
            connector_type="csv",
            label="Demo visibility probe",
            target_tables=["demo_probe_tbl"],
            is_default=True,
        )
    )
    try:
        demo_login = client.post(
            "/api/auth/token",
            data={"username": "user_u", "password": "user_pw", "mode": "demo"},
        )
        assert demo_login.status_code == 200, demo_login.text
        demo_headers = {"Authorization": f"Bearer {demo_login.json()['access_token']}"}

        live_login = client.post(
            "/api/auth/token",
            data={"username": "user_u", "password": "user_pw", "mode": "live"},
        )
        assert live_login.status_code == 200, live_login.text
        live_headers = {"Authorization": f"Bearer {live_login.json()['access_token']}"}

        demo_ids = {
            s["id"] for s in client.get("/api/sources", headers=demo_headers).json()
        }
        live_ids = {
            s["id"] for s in client.get("/api/sources", headers=live_headers).json()
        }

        assert probe_id in demo_ids, "demo mode must see default demo sources"
        assert probe_id not in live_ids, "live mode must hide default demo sources"
    finally:
        registry.patch(probe_id, is_default=False)
        registry.remove(probe_id)


@pytest.fixture(scope="module")
def demo_mode_headers(client):
    resp = client.post(
        "/api/auth/token",
        data={"username": "user_u", "password": "user_pw", "mode": "demo"},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.fixture(scope="module")
def live_mode_headers(client):
    resp = client.post(
        "/api/auth/token",
        data={"username": "user_u", "password": "user_pw", "mode": "live"},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def test_coverage_works_in_both_modes(client, demo_mode_headers, live_mode_headers):
    # Regression: coverage used to call the status endpoint function directly,
    # which broke when status started reading the authenticated user's mode.
    for headers in (demo_mode_headers, live_mode_headers):
        resp = client.get("/api/semantic/coverage", headers=headers)
        assert resp.status_code == 200, resp.text
        assert "score" in resp.json()


def test_dashboard_live_mode_is_empty(client, demo_mode_headers, live_mode_headers):
    demo = client.get("/api/dashboard", headers=demo_mode_headers)
    assert demo.status_code == 200, demo.text
    assert demo.json()["total_orders"] > 0, "demo dashboard must show demo data"

    live = client.get("/api/dashboard", headers=live_mode_headers)
    assert live.status_code == 200, live.text
    body = live.json()
    assert body["total_orders"] == 0
    assert body["total_customers"] == 0
    assert body["recent_orders"] == []


def test_ontology_graph_live_mode_is_empty(
    client, demo_mode_headers, live_mode_headers
):
    demo = client.get("/api/ontology/graph", headers=demo_mode_headers)
    assert demo.status_code == 200, demo.text
    assert len(demo.json()["nodes"]) > 0, "demo mode must show the demo ontology"

    live = client.get("/api/ontology/graph", headers=live_mode_headers)
    assert live.status_code == 200, live.text
    assert live.json() == {"nodes": [], "edges": []}


def test_ontology_mappings_live_mode_is_empty(
    client, demo_mode_headers, live_mode_headers
):
    demo = client.get("/api/ontology/mappings", headers=demo_mode_headers)
    assert demo.status_code == 200, demo.text
    assert len(demo.json()["mappings"]) > 0

    live = client.get("/api/ontology/mappings", headers=live_mode_headers)
    assert live.status_code == 200, live.text
    assert live.json() == {"mappings": [], "raw": {}}


def test_builtin_semantic_definitions_hidden_in_live_mode(
    client, demo_mode_headers, live_mode_headers
):
    for endpoint in (
        "/api/semantic/metrics",
        "/api/semantic/hierarchies",
        "/api/semantic/segments",
    ):
        demo = client.get(endpoint, headers=demo_mode_headers)
        assert demo.status_code == 200, demo.text
        assert any(d["is_builtin"] for d in demo.json()), (
            f"demo mode must include builtin rows on {endpoint}"
        )

        live = client.get(endpoint, headers=live_mode_headers)
        assert live.status_code == 200, live.text
        assert not any(d["is_builtin"] for d in live.json()), (
            f"live mode must hide builtin rows on {endpoint}"
        )


def test_hidden_demo_tables_cover_schema_prefixed_and_legacy_names():
    # Regression: the unified DuckDB snapshot exposes demo tables as
    # "crm.account"/"erp.sales_order_header", and the semantic catalog uses
    # legacy aliases like "dipendenti_hr". Exact-match filtering against bare
    # registry names let all of them leak through to live-mode users.
    from app.main import UserPrincipal, _hidden_demo_tables

    hidden = _hidden_demo_tables(UserPrincipal(username="t", role="user", mode="live"))
    for name in (
        "account",
        "crm.account",
        "erp.sales_order_header",
        "hr.hr_employees",
        "pim.pim_products",
        "dipendenti_hr",
        "product_catalog_pim",
        "hr_pim.dipendenti_hr",
        "_build_meta",
    ):
        assert name in hidden, f"{name} must be hidden in live mode"

    assert (
        _hidden_demo_tables(UserPrincipal(username="t", role="user", mode="demo"))
        == frozenset()
    )


def test_add_source_rejects_reserved_table_names(client, admin_headers):
    # Underscore-prefixed names are internal (_build_meta) on any deployment.
    r = client.post(
        "/api/sources",
        json={
            "connector_type": "csv",
            "label": "x.csv",
            "params": {"table_name": "_sneaky", "inline_csv": "a\n1"},
        },
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text

    # Identifier hygiene: spaces, semicolons and SQL fragments are rejected.
    for bad in ("my table; DROP TABLE x--", "1starts_with_digit", "x" * 64):
        r = client.post(
            "/api/sources",
            json={
                "connector_type": "csv",
                "label": "x.csv",
                "params": {"table_name": bad, "inline_csv": "a\n1"},
            },
            headers=admin_headers,
        )
        assert r.status_code == 422, f"{bad!r}: {r.text}"

    # When demo sources are seeded, demo table names are reserved: whichever
    # source ingests last would silently overwrite the other's table.
    import uuid

    from app.connectors.source_registry import SourceConfig, get_source_registry

    registry = get_source_registry()
    probe_id = f"demo-seed-probe-{uuid.uuid4().hex[:12]}"
    registry.upsert(
        SourceConfig(
            id=probe_id,
            connector_type="crm_sqlite",
            label="seed probe",
            target_tables=["account"],
            is_default=True,
        )
    )
    try:
        r = client.post(
            "/api/sources",
            json={
                "connector_type": "csv",
                "label": "account.csv",
                "params": {"table_name": "account", "inline_csv": "a\n1"},
            },
            headers=admin_headers,
        )
        assert r.status_code == 409, r.text
        assert "reserved" in r.json()["detail"]
    finally:
        registry.patch(probe_id, is_default=False)
        registry.remove(probe_id)


def test_source_response_redacts_inline_csv_and_dsn(client, admin_headers):
    """Source params echo neither raw inline payloads nor DSN credentials.

    inline_csv can be megabytes (and contain sensitive rows) — every sources
    listing would ship it back to the browser. A DSN embeds the database
    password outright.
    """
    csv_payload = "col_a,col_b\n" + "\n".join(f"{i},{i * 2}" for i in range(50))
    r = client.post(
        "/api/sources",
        json={
            "connector_type": "csv",
            "label": "redaction probe",
            "params": {"table_name": "redaction_probe", "inline_csv": csv_payload},
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    try:
        body = r.json()
        assert "col_a" not in json.dumps(body)
        assert body["params"]["inline_csv"].startswith("<inline data:")

        listed = client.get("/api/sources", headers=admin_headers).json()
        mine = next(s for s in listed if s["id"] == sid)
        assert "col_a" not in json.dumps(mine)

        # DSN password redaction
        r2 = client.post(
            "/api/sources",
            json={
                "connector_type": "postgresql",
                "label": "pg probe",
                "params": {
                    "dsn": "postgresql://app_user:s3cret-pw@db.internal:5432/prod",
                    "tables": ["orders"],
                },
            },
            headers=admin_headers,
        )
        assert r2.status_code == 201, r2.text
        sid2 = r2.json()["id"]
        try:
            dsn = r2.json()["params"]["dsn"]
            assert "s3cret-pw" not in dsn
            assert "app_user:***@" in dsn
        finally:
            client.delete(f"/api/sources/{sid2}", headers=admin_headers)
    finally:
        client.delete(f"/api/sources/{sid}", headers=admin_headers)


def test_ontology_extension_roundtrip(client, admin_headers):
    import uuid

    ws = f"test-ws-{uuid.uuid4().hex[:12]}"

    # Empty workspace → null payload, not 404 (frontend treats it as "nothing saved")
    r = client.get(
        "/api/ontology/extension", params={"workspace_id": ws}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["payload"] is None

    doc = {
        "nodes": [
            {
                "id": "n1",
                "label": "Customer",
                "uri": "live:Customer",
                "properties": [{"name": "email", "type": "string"}],
                "position": {"x": 10, "y": 20},
            }
        ],
        "edges": [],
        "addedProperties": [],
    }
    r = client.put(
        "/api/ontology/extension",
        params={"workspace_id": ws},
        json={"payload": doc},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True

    r = client.get(
        "/api/ontology/extension", params={"workspace_id": ws}, headers=admin_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["payload"] == doc
    assert body["updated_at"]

    # Overwrite wins (INSERT OR REPLACE)
    r = client.put(
        "/api/ontology/extension",
        params={"workspace_id": ws},
        json={"payload": {"nodes": [], "edges": [], "addedProperties": []}},
        headers=admin_headers,
    )
    assert r.status_code == 200
    r = client.get(
        "/api/ontology/extension", params={"workspace_id": ws}, headers=admin_headers
    )
    assert r.json()["payload"]["nodes"] == []


def test_ontology_extension_requires_auth(client):
    r = client.get("/api/ontology/extension", params={"workspace_id": "x"})
    assert r.status_code in (401, 403)
    r = client.put(
        "/api/ontology/extension",
        params={"workspace_id": "x"},
        json={"payload": {}},
    )
    assert r.status_code in (401, 403)


def test_ontology_extension_rejects_oversized_payload(client, admin_headers):
    huge = {"blob": "x" * (1024 * 1024 + 100)}
    r = client.put(
        "/api/ontology/extension",
        params={"workspace_id": "big"},
        json={"payload": huge},
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text


def test_ontology_extension_mode_isolation(
    client, demo_mode_headers, live_mode_headers
):
    # Live sessions must not touch demo workspaces (bare sector ids) and
    # demo sessions must not touch 'live-' workspaces — in either direction.
    doc = {"payload": {"nodes": [], "edges": [], "addedProperties": []}}

    # Live token → demo workspace: blocked
    r = client.get(
        "/api/ontology/extension",
        params={"workspace_id": "manufacturing"},
        headers=live_mode_headers,
    )
    assert r.status_code == 403, r.text
    r = client.put(
        "/api/ontology/extension",
        params={"workspace_id": "manufacturing"},
        json=doc,
        headers=live_mode_headers,
    )
    assert r.status_code == 403, r.text

    # Demo token → live workspace: blocked
    r = client.get(
        "/api/ontology/extension",
        params={"workspace_id": "live-manufacturing"},
        headers=demo_mode_headers,
    )
    assert r.status_code == 403, r.text
    r = client.put(
        "/api/ontology/extension",
        params={"workspace_id": "live-manufacturing"},
        json=doc,
        headers=demo_mode_headers,
    )
    assert r.status_code == 403, r.text

    # Matching mode still works in both directions
    r = client.put(
        "/api/ontology/extension",
        params={"workspace_id": "live-manufacturing"},
        json=doc,
        headers=live_mode_headers,
    )
    assert r.status_code == 200, r.text
    r = client.get(
        "/api/ontology/extension",
        params={"workspace_id": "manufacturing"},
        headers=demo_mode_headers,
    )
    assert r.status_code == 200, r.text


def test_user_table_with_demo_name_is_not_hidden_in_live_mode():
    # Regression: "account"/"contact"/"offer" are normal business table names.
    # A live user who uploads a CSV with one of those names must still see
    # their own data — only tables NOT owned by a user-added source are hidden.
    import uuid

    from app.connectors.source_registry import SourceConfig, get_source_registry
    from app.main import UserPrincipal, _hidden_demo_tables

    registry = get_source_registry()
    probe_id = f"csv-collision-probe-{uuid.uuid4().hex[:12]}"
    registry.upsert(
        SourceConfig(
            id=probe_id,
            connector_type="csv",
            label="account.csv",
            params={"table_name": "account", "inline_csv": "id\n1"},
            is_default=False,
        )
    )
    try:
        live = UserPrincipal(username="t", role="user", mode="live")
        hidden = _hidden_demo_tables(live)
        assert "account" not in hidden, (
            "a user-owned table must not be hidden even if it collides "
            "with a demo table name"
        )
        assert f"{probe_id}.account" not in hidden
        # Other demo tables stay hidden.
        assert "sales_order_header" in hidden
        assert "crm.contact" in hidden
    finally:
        registry.remove(probe_id)


def test_semantic_status_live_mode_is_empty(
    client, demo_mode_headers, live_mode_headers
):
    # The test environment may not build the demo KG, so the demo side only
    # checks the endpoint works; the regression target is live-mode emptiness.
    demo = client.get("/api/semantic/status", headers=demo_mode_headers)
    assert demo.status_code == 200, demo.text
    # Regression: status must build the semantic stack on a cold process
    # instead of answering loaded=false — that made the dashboard show
    # "Not built yet" right after every backend restart.
    assert demo.json()["loaded"] is True

    live = client.get("/api/semantic/status", headers=live_mode_headers)
    assert live.status_code == 200, live.text
    body = live.json()
    assert body["entities"] == []
    assert body["kg_nodes"] == 0
    assert body["kg_edges"] == 0
    assert body["sources"] == []


def test_semantic_sources_live_mode_is_empty(
    client, demo_mode_headers, live_mode_headers
):
    # Demo side: just check endpoint works (semantic layer may not be loaded in CI)
    demo = client.get("/api/semantic/sources", headers=demo_mode_headers)
    assert demo.status_code == 200, demo.text

    live = client.get("/api/semantic/sources", headers=live_mode_headers)
    assert live.status_code == 200, live.text
    assert live.json() == []


def test_live_ask_returns_409_when_no_real_sources(client, live_mode_headers):
    # A live-mode user with no user-added sources must get 409 — silently
    # using the demo dataset would produce nonsense business answers.
    resp = client.post(
        "/api/semantic/ask",
        json={"question": "How many orders do we have?"},
        headers=live_mode_headers,
    )
    assert resp.status_code == 409, resp.text
    assert "data source" in resp.json().get("detail", "").lower()


def test_live_ask_bypasses_409_when_user_source_registered(client, live_mode_headers):
    import uuid

    from app.connectors.source_registry import SourceConfig, get_source_registry

    registry = get_source_registry()
    probe_id = f"csv-live-ask-probe-{uuid.uuid4().hex[:12]}"
    registry.upsert(
        SourceConfig(
            id=probe_id,
            connector_type="csv",
            label="orders.csv",
            params={"table_name": "my_orders", "inline_csv": "id,amount\n1,100"},
            is_default=False,
        )
    )
    try:
        resp = client.post(
            "/api/semantic/ask",
            json={"question": "How many orders do we have?"},
            headers=live_mode_headers,
        )
        # 409 must NOT fire — user has a real connected source.
        # The ask may fail for other reasons (no LLM key, unknown intent, etc.)
        # but not with the "no data sources" guard.
        assert resp.status_code != 409, (
            "live ask must not return 409 when a user source is registered"
        )
    finally:
        registry.remove(probe_id)


# ── /api/semantic/live-config ──────────────────────────────────────────────────


def test_live_config_requires_auth(client):
    resp = client.get("/api/semantic/live-config")
    assert resp.status_code == 401


def test_live_config_returns_required_fields(client, user_headers):
    resp = client.get("/api/semantic/live-config", headers=user_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    for field in (
        "name",
        "domain",
        "connectors",
        "ontology",
        "metrics",
        "funnel",
        "process_stages",
        "built_at",
    ):
        assert field in body, f"live-config missing field: {field}"
    assert isinstance(body["connectors"], list)
    assert isinstance(body["ontology"]["nodes"], list)
    assert isinstance(body["ontology"]["edges"], list)
    assert isinstance(body["metrics"], list)
    assert isinstance(body["process_stages"], list)


def test_live_config_live_mode_is_empty(client, live_mode_headers):
    # A fresh live workspace with no user-added sources must return an
    # empty ontology graph and no metrics so the frontend starts clean.
    resp = client.get("/api/semantic/live-config", headers=live_mode_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ontology"]["nodes"] == [], "live-config must have no ontology nodes"
    assert body["ontology"]["edges"] == [], "live-config must have no ontology edges"
    assert body["metrics"] == [], "live-config must have no metrics"
    assert body["connectors"] == [], "live-config must have no connectors"
    assert body["name"] == "Your Dataset"


def test_live_config_shows_user_source_connector(client, live_mode_headers):
    import uuid

    from app.connectors.source_registry import SourceConfig, get_source_registry

    registry = get_source_registry()
    probe_id = f"csv-lc-probe-{uuid.uuid4().hex[:12]}"
    probe_label = f"My Sales Data {probe_id[:8]}"
    registry.upsert(
        SourceConfig(
            id=probe_id,
            connector_type="csv",
            label=probe_label,
            params={"table_name": "live_sales", "inline_csv": "id,amount\n1,500"},
            is_default=False,
        )
    )
    try:
        resp = client.get("/api/semantic/live-config", headers=live_mode_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert probe_label in body["connectors"], (
            "user-added source must appear in live-config connectors"
        )
    finally:
        registry.remove(probe_id)


# ── /api/semantic/example-questions ───────────────────────────────────────────


def test_example_questions_is_public(client):
    # This endpoint has no auth — the frontend uses it on the landing screen.
    resp = client.get("/api/semantic/example-questions")
    assert resp.status_code == 200, resp.text
    assert isinstance(resp.json(), list)


def test_example_questions_structure(client):
    resp = client.get("/api/semantic/example-questions")
    assert resp.status_code == 200, resp.text
    for item in resp.json():
        assert "question" in item
        assert "description" in item
        assert isinstance(item["question"], str)


def test_example_questions_live_mode_is_empty(client, live_mode_headers):
    # Live workspace with no user data must return [] so the UI shows a
    # clean "connect your data" prompt instead of demo questions.
    resp = client.get(
        "/api/semantic/example-questions",
        headers=live_mode_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == [], (
        "example-questions must be empty for a live workspace with no sources"
    )


# ── /api/semantic/system-prompt ───────────────────────────────────────────────


def test_system_prompt_is_public(client):
    resp = client.get("/api/semantic/system-prompt")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "prompt" in body
    assert isinstance(body["prompt"], str)
    assert len(body["prompt"]) > 0


def test_system_prompt_live_mode_excludes_demo_tables(client, live_mode_headers):
    # The system prompt fed to the LLM in direct mode must not expose demo
    # table names to live-mode users (information leakage + confusing schema).
    demo_resp = client.get("/api/semantic/system-prompt")
    live_resp = client.get(
        "/api/semantic/system-prompt",
        headers=live_mode_headers,
    )
    assert live_resp.status_code == 200, live_resp.text
    live_prompt = live_resp.json()["prompt"]
    # Key demo table names must not appear in the live prompt.
    for demo_table in ("sales_order_header", "dipendenti_hr", "product_catalog_pim"):
        assert demo_table not in live_prompt, (
            f"demo table '{demo_table}' must not appear in live-mode system prompt"
        )
    # Ensure the live prompt is shorter / simpler than the demo one.
    demo_prompt = demo_resp.json()["prompt"]
    assert len(live_prompt) <= len(demo_prompt), (
        "live prompt must not be longer than demo prompt (demo schema leaked)"
    )


# ── Live onboarding end-to-end ─────────────────────────────────────────────────


def test_live_onboarding_add_csv_and_verify(client, admin_headers, live_mode_headers):
    """Full live-mode onboarding: add CSV source → verify it appears in status
    and live-config → delete → verify it disappears."""
    import uuid

    source_id = f"live-onboard-{uuid.uuid4().hex[:10]}"
    table_name = f"onboard_{uuid.uuid4().hex[:8]}"
    inline_csv = "order_id,amount,status\n1,100,shipped\n2,200,pending\n3,50,shipped"

    # 1. Add the CSV source as admin — triggers auto-rebuild.
    add_resp = client.post(
        "/api/sources",
        json={
            "connector_type": "csv",
            "label": "Onboarding Test CSV",
            "params": {
                "id": source_id,
                "table_name": table_name,
                "inline_csv": inline_csv,
            },
        },
        headers=admin_headers,
    )
    assert add_resp.status_code == 201, add_resp.text
    body = add_resp.json()
    assert body["id"] == source_id
    assert body["connector_type"] == "csv"

    try:
        # 2. Source must appear in the listing (both admin and live-mode user).
        sources_resp = client.get("/api/sources", headers=live_mode_headers)
        assert sources_resp.status_code == 200, sources_resp.text
        ids = [s["id"] for s in sources_resp.json()]
        assert source_id in ids, "newly added source must appear in /api/sources"

        # 3. After auto-rebuild, the semantic status must list the new entity.
        # DuckDB namespaces tables as "{source_id}.{table_name}"; the entity name
        # is the bare table_name. Either form confirms the source was ingested.
        status_resp = client.get("/api/semantic/status", headers=live_mode_headers)
        assert status_resp.status_code == 200, status_resp.text
        status_body = status_resp.json()
        assert status_body["loaded"] is True
        assert table_name in status_body.get("entities", []), (
            f"entity '{table_name}' must appear in semantic status after CSV ingest"
        )

        # 4. The live-config ontology nodes must include the new table.
        lc_resp = client.get("/api/semantic/live-config", headers=live_mode_headers)
        assert lc_resp.status_code == 200, lc_resp.text
        db_tables = [n["data"]["db_table"] for n in lc_resp.json()["ontology"]["nodes"]]
        assert table_name in db_tables, (
            "live-config ontology nodes must include the newly added table"
        )

        # 5. The live ask must NOT return 409 now that we have a real source.
        ask_resp = client.post(
            "/api/semantic/ask",
            json={"question": "How many orders?"},
            headers=live_mode_headers,
        )
        assert ask_resp.status_code != 409, (
            "ask must not return 409 after a real source is connected"
        )

    finally:
        # 6. Cleanup: delete the source (also triggers a rebuild).
        del_resp = client.delete(f"/api/sources/{source_id}", headers=admin_headers)
        assert del_resp.status_code == 204, del_resp.text
        # Verify the source is gone.
        ids_after = [
            s["id"] for s in client.get("/api/sources", headers=admin_headers).json()
        ]
        assert source_id not in ids_after


# ── /api/data/store/status ────────────────────────────────────────────────────


def test_data_store_status_requires_auth(client):
    resp = client.get("/api/data/store/status")
    assert resp.status_code == 401


def test_data_store_status_demo_mode(client, user_headers):
    resp = client.get("/api/data/store/status", headers=user_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "tables" in body
    assert "row_counts" in body
    assert "total_rows" in body
    assert isinstance(body["tables"], list)
    assert isinstance(body["row_counts"], dict)
    assert body["total_rows"] >= 0


def test_data_store_status_live_mode_hides_demo_tables(
    client, demo_mode_headers, live_mode_headers
):
    demo = client.get("/api/data/store/status", headers=demo_mode_headers)
    live = client.get("/api/data/store/status", headers=live_mode_headers)
    assert demo.status_code == 200
    assert live.status_code == 200
    demo_tables = set(demo.json()["tables"])
    live_tables = set(live.json()["tables"])
    # Demo tables the live user must never see.
    for t in ("sales_order_header", "dipendenti_hr", "account", "product_catalog_pim"):
        if t in demo_tables:
            assert t not in live_tables, (
                f"demo table '{t}' must be hidden from live-mode users"
            )
    # Live mode has fewer (or equal) tables than demo mode.
    assert len(live_tables) <= len(demo_tables)


# ── /api/data/store/rebuild ───────────────────────────────────────────────────


def test_data_store_rebuild_requires_admin(client, user_headers):
    resp = client.post("/api/data/store/rebuild", headers=user_headers)
    assert resp.status_code == 403


def test_data_store_rebuild_admin_succeeds(client, admin_headers):
    resp = client.post("/api/data/store/rebuild", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["rebuilt"] is True
    assert "row_counts" in body
    assert "total_rows" in body


# ── /api/semantic/draft ───────────────────────────────────────────────────────


def test_semantic_draft_requires_auth(client):
    resp = client.get("/api/semantic/draft")
    assert resp.status_code == 401


def test_semantic_draft_returns_structure(client, user_headers):
    resp = client.get("/api/semantic/draft", headers=user_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "entities" in body
    assert "relations" in body
    assert "metrics" in body
    assert isinstance(body["entities"], list)
    assert isinstance(body["relations"], list)
    assert isinstance(body["metrics"], list)


def test_semantic_draft_live_mode_hides_demo_entities(
    client, demo_mode_headers, live_mode_headers
):
    demo = client.get("/api/semantic/draft", headers=demo_mode_headers)
    live = client.get("/api/semantic/draft", headers=live_mode_headers)
    assert demo.status_code == 200
    assert live.status_code == 200
    demo_entity_names = {e["name"] for e in demo.json()["entities"]}
    live_entity_names = {e["name"] for e in live.json()["entities"]}
    # Live mode must show a strict subset — demo data must be hidden.
    assert live_entity_names <= demo_entity_names, (
        "live-mode draft must not introduce entities absent from demo"
    )
    # Critically, the live workspace has no user sources so ALL demo entities
    # must be hidden, resulting in an empty entities list.
    assert live_entity_names == set(), (
        "live-mode draft must have empty entities when no user sources are connected"
    )
    assert live.json()["metrics"] == [], "live draft must have no metrics"
    assert live.json()["relations"] == [], "live draft must have no relations"


# ── PATCH /api/semantic/draft/entities/{name} ─────────────────────────────────


def test_patch_draft_entity_requires_auth(client):
    resp = client.patch(
        "/api/semantic/draft/entities/SalesOrder",
        json={"user_description": "test"},
    )
    assert resp.status_code == 401


def test_patch_draft_entity_unknown_404(client, user_headers):
    resp = client.patch(
        "/api/semantic/draft/entities/NonExistentEntity999",
        json={"user_description": "This entity does not exist"},
        headers=user_headers,
    )
    assert resp.status_code == 404


def test_patch_draft_entity_updates_description(client, user_headers):
    # Pick a real entity from the demo catalog.
    draft = client.get("/api/semantic/draft", headers=user_headers).json()
    if not draft["entities"]:
        import pytest

        pytest.skip("no entities in demo catalog")
    entity_name = draft["entities"][0]["name"]
    new_desc = "Integration-test description — updated by test suite"
    resp = client.patch(
        f"/api/semantic/draft/entities/{entity_name}",
        json={"user_description": new_desc},
        headers=user_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["ok"] is True
    # Verify the change is reflected in the draft.
    updated = client.get("/api/semantic/draft", headers=user_headers).json()
    match = next((e for e in updated["entities"] if e["name"] == entity_name), None)
    assert match is not None
    assert match["user_description"] == new_desc


# ── /api/semantic/coverage live-mode ─────────────────────────────────────────


def test_semantic_coverage_live_mode_excludes_builtins(
    client, demo_mode_headers, live_mode_headers
):
    demo = client.get("/api/semantic/coverage", headers=demo_mode_headers)
    live = client.get("/api/semantic/coverage", headers=live_mode_headers)
    assert demo.status_code == 200
    assert live.status_code == 200
    # Demo mode sees the builtin definitions; live mode hides them.
    # The live score must therefore be <= demo score (fewer definitions = lower coverage).
    demo_score = demo.json()["score"]
    live_score = live.json()["score"]
    # Live score should be 0 or very low (no user data = no coverage).
    # At minimum it must not exceed demo (we have MORE demo definitions than live ones).
    assert live_score <= demo_score, (
        f"live coverage score ({live_score}) must not exceed demo score ({demo_score})"
    )


# ── /api/sources/{id}/sync ────────────────────────────────────────────────────


def test_sync_source_requires_admin(client, user_headers):
    resp = client.post("/api/sources/erp/sync", headers=user_headers)
    assert resp.status_code == 403


def test_sync_source_not_found_404(client, admin_headers):
    resp = client.post("/api/sources/does-not-exist-xyz/sync", headers=admin_headers)
    assert resp.status_code == 404


def test_sync_source_succeeds_for_existing(client, admin_headers):
    # Use the first default source (guaranteed to exist).
    sources = client.get("/api/sources", headers=admin_headers).json()
    defaults = [s for s in sources if s.get("is_default")]
    if not defaults:
        import pytest

        pytest.skip("no default sources seeded")
    source_id = defaults[0]["id"]
    resp = client.post(f"/api/sources/{source_id}/sync", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == source_id
    assert body["connector_type"] == defaults[0]["connector_type"]


# ── /api/agents/custom ────────────────────────────────────────────────────────

_AGENT_PAYLOAD = {
    "id": "test-agent-001",
    "sector_id": "test-sector",
    "name": "Test Monitor Agent",
    "description": "Created by integration test suite",
    "template": "monitor",
    "entities": ["Customer", "Order"],
    "findings": [],
    "actions": [],
    "trigger": {"kind": "manual"},
    "created_at": "2025-01-01T00:00:00+00:00",
    "last_run_at": None,
}


def test_agents_list_requires_auth(client):
    resp = client.get("/api/agents/custom")
    assert resp.status_code == 401


def test_agents_list_returns_list(client, user_headers):
    resp = client.get(
        "/api/agents/custom",
        params={"sector_id": "test-sector"},
        headers=user_headers,
    )
    assert resp.status_code == 200, resp.text
    assert isinstance(resp.json(), list)


def test_agents_create_requires_auth(client):
    resp = client.post("/api/agents/custom", json=_AGENT_PAYLOAD)
    assert resp.status_code == 401


def test_agents_create_succeeds(client, user_headers):
    resp = client.post("/api/agents/custom", json=_AGENT_PAYLOAD, headers=user_headers)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["id"] == _AGENT_PAYLOAD["id"]
    assert body["name"] == _AGENT_PAYLOAD["name"]
    assert "created_at" in body
    assert "updated_at" in body


def test_agents_create_appears_in_list(client, user_headers):
    resp = client.get(
        "/api/agents/custom",
        params={"sector_id": "test-sector"},
        headers=user_headers,
    )
    assert resp.status_code == 200
    ids = [a["id"] for a in resp.json()]
    assert _AGENT_PAYLOAD["id"] in ids


def test_agents_update_requires_auth(client):
    resp = client.put(f"/api/agents/custom/{_AGENT_PAYLOAD['id']}", json=_AGENT_PAYLOAD)
    assert resp.status_code == 401


def test_agents_update_succeeds(client, user_headers):
    updated = {**_AGENT_PAYLOAD, "name": "Updated Agent Name"}
    resp = client.put(
        f"/api/agents/custom/{_AGENT_PAYLOAD['id']}",
        json=updated,
        headers=user_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Updated Agent Name"


def test_agents_update_unknown_404(client, user_headers):
    resp = client.put(
        "/api/agents/custom/nonexistent-agent-xyz",
        json=_AGENT_PAYLOAD,
        headers=user_headers,
    )
    assert resp.status_code == 404


def test_agents_delete_requires_auth(client):
    resp = client.delete(f"/api/agents/custom/{_AGENT_PAYLOAD['id']}")
    assert resp.status_code == 401


def test_agents_delete_succeeds(client, user_headers):
    resp = client.delete(
        f"/api/agents/custom/{_AGENT_PAYLOAD['id']}", headers=user_headers
    )
    assert resp.status_code == 204


def test_agents_delete_removes_from_list(client, user_headers):
    resp = client.get(
        "/api/agents/custom",
        params={"sector_id": "test-sector"},
        headers=user_headers,
    )
    assert resp.status_code == 200
    ids = [a["id"] for a in resp.json()]
    assert _AGENT_PAYLOAD["id"] not in ids


# ── /api/queries/saved ────────────────────────────────────────────────────────

_QUERY_PAYLOAD = {
    "id": "test-query-001",
    "sector_id": "test-sector",
    "query": "SELECT * FROM orders LIMIT 10",
    "created_at": "2025-01-01T00:00:00+00:00",
}


def test_saved_queries_list_requires_auth(client):
    resp = client.get("/api/queries/saved", params={"sector_id": "test-sector"})
    assert resp.status_code == 401


def test_saved_queries_list_returns_list(client, user_headers):
    resp = client.get(
        "/api/queries/saved",
        params={"sector_id": "test-sector"},
        headers=user_headers,
    )
    assert resp.status_code == 200, resp.text
    assert isinstance(resp.json(), list)


def test_saved_queries_save_requires_auth(client):
    resp = client.post("/api/queries/saved", json=_QUERY_PAYLOAD)
    assert resp.status_code == 401


def test_saved_queries_save_succeeds(client, user_headers):
    resp = client.post("/api/queries/saved", json=_QUERY_PAYLOAD, headers=user_headers)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["id"] == _QUERY_PAYLOAD["id"]
    assert body["query"] == _QUERY_PAYLOAD["query"]


def test_saved_queries_save_appears_in_list(client, user_headers):
    resp = client.get(
        "/api/queries/saved",
        params={"sector_id": "test-sector"},
        headers=user_headers,
    )
    assert resp.status_code == 200
    ids = [q["id"] for q in resp.json()]
    assert _QUERY_PAYLOAD["id"] in ids


def test_saved_queries_delete_requires_auth(client):
    resp = client.delete(f"/api/queries/saved/{_QUERY_PAYLOAD['id']}")
    assert resp.status_code == 401


def test_saved_queries_delete_succeeds(client, user_headers):
    resp = client.delete(
        f"/api/queries/saved/{_QUERY_PAYLOAD['id']}", headers=user_headers
    )
    assert resp.status_code == 204


def test_saved_queries_delete_removes_from_list(client, user_headers):
    resp = client.get(
        "/api/queries/saved",
        params={"sector_id": "test-sector"},
        headers=user_headers,
    )
    assert resp.status_code == 200
    ids = [q["id"] for q in resp.json()]
    assert _QUERY_PAYLOAD["id"] not in ids


# ── /api/semantic/templates ───────────────────────────────────────────────────

_TEMPLATE_PAYLOAD = {
    "name": "Integration Test Template",
    "description": "Created by the integration test suite",
    "sql_query": "SELECT id, total FROM orders LIMIT {limit}",
    "keywords": ["orders", "total"],
    "sources": ["SalesOrder"],
}


def test_templates_list_requires_auth(client):
    resp = client.get("/api/semantic/templates")
    assert resp.status_code == 401


def test_templates_list_returns_list(client, user_headers):
    resp = client.get("/api/semantic/templates", headers=user_headers)
    assert resp.status_code == 200, resp.text
    assert isinstance(resp.json(), list)


def test_templates_create_requires_admin(client, user_headers):
    resp = client.post(
        "/api/semantic/templates", json=_TEMPLATE_PAYLOAD, headers=user_headers
    )
    assert resp.status_code == 403


def test_templates_create_admin_succeeds(client, admin_headers):
    resp = client.post(
        "/api/semantic/templates", json=_TEMPLATE_PAYLOAD, headers=admin_headers
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == _TEMPLATE_PAYLOAD["name"]
    assert "id" in body


def test_templates_create_invalid_token_422(client, admin_headers):
    bad = {**_TEMPLATE_PAYLOAD, "sql_query": "SELECT {bad_token} FROM orders"}
    resp = client.post("/api/semantic/templates", json=bad, headers=admin_headers)
    assert resp.status_code == 422


def test_templates_update_requires_admin(client, user_headers, admin_headers):
    templates = client.get("/api/semantic/templates", headers=admin_headers).json()
    test_tpl = next(
        (t for t in templates if t["name"] == _TEMPLATE_PAYLOAD["name"]), None
    )
    if test_tpl is None:
        import pytest

        pytest.skip("test template not found")
    resp = client.patch(
        f"/api/semantic/templates/{test_tpl['id']}",
        json={"description": "updated desc"},
        headers=user_headers,
    )
    assert resp.status_code == 403


def test_templates_update_admin_succeeds(client, admin_headers):
    templates = client.get("/api/semantic/templates", headers=admin_headers).json()
    test_tpl = next(
        (t for t in templates if t["name"] == _TEMPLATE_PAYLOAD["name"]), None
    )
    if test_tpl is None:
        import pytest

        pytest.skip("test template not found")
    resp = client.patch(
        f"/api/semantic/templates/{test_tpl['id']}",
        json={"description": "Updated by integration test"},
        headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["description"] == "Updated by integration test"


def test_templates_update_unknown_404(client, admin_headers):
    resp = client.patch(
        "/api/semantic/templates/999999",
        json={"description": "ghost"},
        headers=admin_headers,
    )
    assert resp.status_code == 404


def test_templates_delete_requires_admin(client, user_headers, admin_headers):
    templates = client.get("/api/semantic/templates", headers=admin_headers).json()
    test_tpl = next(
        (t for t in templates if t["name"] == _TEMPLATE_PAYLOAD["name"]), None
    )
    if test_tpl is None:
        import pytest

        pytest.skip("test template not found")
    resp = client.delete(
        f"/api/semantic/templates/{test_tpl['id']}", headers=user_headers
    )
    assert resp.status_code == 403


def test_templates_delete_admin_succeeds(client, admin_headers):
    templates = client.get("/api/semantic/templates", headers=admin_headers).json()
    test_tpl = next(
        (t for t in templates if t["name"] == _TEMPLATE_PAYLOAD["name"]), None
    )
    if test_tpl is None:
        import pytest

        pytest.skip("test template not found")
    resp = client.delete(
        f"/api/semantic/templates/{test_tpl['id']}", headers=admin_headers
    )
    assert resp.status_code == 204


# ── /api/semantic/draft/context ───────────────────────────────────────────────


def test_context_docs_list_requires_auth(client):
    resp = client.get("/api/semantic/draft/context")
    assert resp.status_code == 401


def test_context_docs_list_returns_list(client, user_headers):
    resp = client.get("/api/semantic/draft/context", headers=user_headers)
    assert resp.status_code == 200, resp.text
    assert isinstance(resp.json(), list)


def test_context_docs_add_requires_auth(client):
    resp = client.post(
        "/api/semantic/draft/context",
        json={"title": "Test Doc", "content": "Test business context"},
    )
    assert resp.status_code == 401


def test_context_docs_add_succeeds(client, user_headers):
    resp = client.post(
        "/api/semantic/draft/context",
        json={
            "title": "Integration Test Doc",
            "content": "This is test business context for the integration test suite.",
        },
        headers=user_headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["title"] == "Integration Test Doc"
    assert "id" in body
    assert "created_at" in body


def test_context_docs_add_appears_in_list(client, user_headers):
    resp = client.get("/api/semantic/draft/context", headers=user_headers)
    assert resp.status_code == 200
    titles = [d["title"] for d in resp.json()]
    assert "Integration Test Doc" in titles


def test_context_docs_delete_requires_auth(client, user_headers):
    docs = client.get("/api/semantic/draft/context", headers=user_headers).json()
    test_doc = next((d for d in docs if d["title"] == "Integration Test Doc"), None)
    if test_doc is None:
        import pytest

        pytest.skip("test context doc not found")
    resp = client.delete(f"/api/semantic/draft/context/{test_doc['id']}")
    assert resp.status_code == 401


def test_context_docs_delete_unknown_404(client, user_headers):
    resp = client.delete(
        "/api/semantic/draft/context/nonexistent-doc-id-xyz", headers=user_headers
    )
    assert resp.status_code == 404


def test_context_docs_delete_succeeds(client, user_headers):
    docs = client.get("/api/semantic/draft/context", headers=user_headers).json()
    test_doc = next((d for d in docs if d["title"] == "Integration Test Doc"), None)
    if test_doc is None:
        import pytest

        pytest.skip("test context doc not found")
    resp = client.delete(
        f"/api/semantic/draft/context/{test_doc['id']}", headers=user_headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["ok"] is True


# ── PATCH /api/semantic/draft/metrics/{name} ──────────────────────────────────


def test_patch_draft_metric_requires_auth(client):
    resp = client.patch(
        "/api/semantic/draft/metrics/revenue",
        json={"description": "test"},
    )
    assert resp.status_code == 401


def test_patch_draft_metric_unknown_404(client, user_headers):
    resp = client.patch(
        "/api/semantic/draft/metrics/NonExistentMetric999",
        json={"description": "ghost metric"},
        headers=user_headers,
    )
    assert resp.status_code == 404


def test_patch_draft_metric_updates_description(client, user_headers):
    draft = client.get("/api/semantic/draft", headers=user_headers).json()
    if not draft["metrics"]:
        import pytest

        pytest.skip("no metrics in demo catalog")
    metric_name = draft["metrics"][0]["name"]
    new_desc = "Integration-test metric description — set by test suite"
    resp = client.patch(
        f"/api/semantic/draft/metrics/{metric_name}",
        json={"description": new_desc},
        headers=user_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["ok"] is True
    updated = client.get("/api/semantic/draft", headers=user_headers).json()
    match = next((m for m in updated["metrics"] if m["name"] == metric_name), None)
    assert match is not None
    assert match["description"] == new_desc
