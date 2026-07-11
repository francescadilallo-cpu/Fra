"""Dashboard pins endpoint tests — CRUD, sector scoping, auth."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture(scope="module")
def client():
    def _hash(pw):
        salt = secrets.token_hex(16)
        digest = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 120_000)
        return f"pbkdf2_sha256$120000${salt}${base64.b64encode(digest).decode()}"

    os.environ["AUTH_USERS_JSON"] = json.dumps(
        [
            {
                "username": "u",
                "password_hash": _hash("pw"),
                "role": "user",
                "disabled": False,
            }
        ]
    )
    os.environ["JWT_SECRET_KEY"] = "dashboard-pins-test-secret-32bytes!"
    os.environ["SEMANTIC_REQUIRE_LLM_INTENT"] = "0"

    import app.main as m
    from fastapi.testclient import TestClient

    limiter = getattr(m.app.state, "limiter", None)
    if limiter:
        limiter.enabled = False
    with TestClient(m.app) as c:
        r = c.post("/api/auth/token", data={"username": "u", "password": "pw"})
        yield c, {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    import app.main as m

    monkeypatch.setattr(m, "_PINS_DB_PATH", tmp_path / "pins.db")


def test_pin_crud_and_sector_scoping(client):
    c, h = client
    sector = f"live-test-{uuid.uuid4().hex[:6]}"
    pin = {
        "id": uuid.uuid4().hex,
        "sector_id": sector,
        "question": "Top customers by revenue this year",
        "title": "Top customers",
    }
    r = c.post("/api/dashboard/pins", json=pin, headers=h)
    assert r.status_code == 201
    assert r.json()["pinned_by"] == "u"

    r = c.get(f"/api/dashboard/pins?sector_id={sector}", headers=h)
    assert r.status_code == 200
    assert [p["id"] for p in r.json()] == [pin["id"]]
    # Other sectors see nothing.
    r = c.get("/api/dashboard/pins?sector_id=other", headers=h)
    assert r.json() == []

    assert c.delete(f"/api/dashboard/pins/{pin['id']}", headers=h).status_code == 204
    assert c.get(f"/api/dashboard/pins?sector_id={sector}", headers=h).json() == []


def test_same_id_upserts(client):
    c, h = client
    pin = {
        "id": "pin-1",
        "sector_id": "live-x",
        "question": "How many orders?",
    }
    assert c.post("/api/dashboard/pins", json=pin, headers=h).status_code == 201
    pin["question"] = "How many orders in 2026?"
    assert c.post("/api/dashboard/pins", json=pin, headers=h).status_code == 201
    rows = c.get("/api/dashboard/pins?sector_id=live-x", headers=h).json()
    assert len(rows) == 1 and "2026" in rows[0]["question"]


def test_requires_auth(client):
    c, _h = client
    assert c.get("/api/dashboard/pins?sector_id=x").status_code == 401
    assert c.post("/api/dashboard/pins", json={}).status_code == 401
    assert c.delete("/api/dashboard/pins/x").status_code == 401
