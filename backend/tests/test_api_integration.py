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
