"""Integration tests for POST /api/semantic/integrate (stage-4 conversational).

Checks auth and that the endpoint degrades cleanly when no LLM is configured
(no crash, explanatory notes) — part of live-path hardening.
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


def _hash_pw(pw: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 120_000)
    return f"pbkdf2_sha256$120000${salt}${base64.b64encode(digest).decode()}"


@pytest.fixture(scope="module")
def _env():
    users = [
        {
            "username": "int_u",
            "password_hash": _hash_pw("int_pw"),
            "role": "user",
            "disabled": False,
        }
    ]
    os.environ["AUTH_USERS_JSON"] = json.dumps(users)
    os.environ["JWT_SECRET_KEY"] = "integrate-test-secret-32chars!!!!!"
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
def headers(client):
    resp = client.post(
        "/api/auth/token", data={"username": "int_u", "password": "int_pw"}
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def test_requires_auth(client):
    resp = client.post("/api/semantic/integrate", json={"instruction": "link a to b"})
    assert resp.status_code == 401


def test_degrades_without_llm(client, headers):
    resp = client.post(
        "/api/semantic/integrate",
        json={"instruction": "link orders to customers via customer_id"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # No LLM provider in the test env → nothing applied, clear note, no crash.
    assert body["llm_used"] is False
    assert body["applied"] == []
    assert "LLM" in body["notes"]
    assert "draft" in body


def test_empty_instruction_rejected(client, headers):
    resp = client.post(
        "/api/semantic/integrate", json={"instruction": ""}, headers=headers
    )
    assert resp.status_code == 422
