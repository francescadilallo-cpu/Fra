"""Integration tests for admin routers: workspace, users, tokens, notifications."""

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
    os.environ["JWT_SECRET_KEY"] = "admin-router-test-secret-32chars!!"
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
def admin_headers(client):
    resp = client.post(
        "/api/auth/token", data={"username": "admin_u", "password": "admin_pw"}
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.fixture(scope="module")
def user_headers(client):
    resp = client.post(
        "/api/auth/token", data={"username": "user_u", "password": "user_pw"}
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


# ── Workspace ─────────────────────────────────────────────────────────────────


def test_workspace_get_returns_shape(client, user_headers):
    resp = client.get("/api/workspace", headers=user_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "name" in data
    assert "sector_id" in data


def test_workspace_put_saves_name(client, admin_headers):
    resp = client.put(
        "/api/workspace",
        json={"name": "Acme Test Co", "sector_id": None},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Acme Test Co"


def test_workspace_put_rejects_invalid_sector(client, admin_headers):
    resp = client.put(
        "/api/workspace",
        json={"name": None, "sector_id": "space_travel"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["sector_id"] != "space_travel"


def test_workspace_put_accepts_valid_sector(client, admin_headers):
    resp = client.put(
        "/api/workspace",
        json={"name": None, "sector_id": "retail"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["sector_id"] == "retail"


def test_workspace_put_strips_html_tags(client, admin_headers):
    resp = client.put(
        "/api/workspace",
        json={"name": "<b>Bold Corp</b>", "sector_id": None},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Bold Corp"


def test_workspace_put_allowed_for_user_role(client, user_headers):
    resp = client.put(
        "/api/workspace",
        json={"name": "User Update", "sector_id": None},
        headers=user_headers,
    )
    assert resp.status_code == 200


def test_workspace_requires_auth(client):
    resp = client.get("/api/workspace")
    assert resp.status_code == 401


# ── Users ─────────────────────────────────────────────────────────────────────


def test_users_list_requires_admin(client, user_headers):
    resp = client.get("/api/users", headers=user_headers)
    assert resp.status_code == 403


def test_users_invite_and_remove(client, admin_headers):
    resp = client.post(
        "/api/users",
        json={"email": "testuser@example.com", "role": "viewer"},
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    member = resp.json()
    assert member["email"] == "testuser@example.com"
    assert member["role"] == "viewer"
    mid = member["id"]

    resp = client.get("/api/users", headers=admin_headers)
    assert resp.status_code == 200
    ids = [m["id"] for m in resp.json()]
    assert mid in ids

    resp = client.delete(f"/api/users/{mid}", headers=admin_headers)
    assert resp.status_code == 204


def test_users_invite_invalid_email_422(client, admin_headers):
    resp = client.post(
        "/api/users",
        json={"email": "not-an-email", "role": "editor"},
        headers=admin_headers,
    )
    assert resp.status_code == 422


def test_users_invite_invalid_role_422(client, admin_headers):
    resp = client.post(
        "/api/users",
        json={"email": "a@b.com", "role": "superuser"},
        headers=admin_headers,
    )
    assert resp.status_code == 422


def test_users_remove_unknown_404(client, admin_headers):
    resp = client.delete("/api/users/does-not-exist", headers=admin_headers)
    assert resp.status_code == 404


def test_users_remove_oversized_id_422(client, admin_headers):
    resp = client.delete(f"/api/users/{'x' * 65}", headers=admin_headers)
    assert resp.status_code == 422


def test_users_role_update(client, admin_headers):
    resp = client.post(
        "/api/users",
        json={"email": "roletest@example.com", "role": "viewer"},
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    mid = resp.json()["id"]

    resp = client.patch(
        f"/api/users/{mid}/role", json={"role": "editor"}, headers=admin_headers
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    resp = client.patch(
        f"/api/users/{mid}/role", json={"role": "superuser"}, headers=admin_headers
    )
    assert resp.status_code == 422

    resp = client.patch(
        "/api/users/does-not-exist/role", json={"role": "editor"}, headers=admin_headers
    )
    assert resp.status_code == 404

    client.delete(f"/api/users/{mid}", headers=admin_headers)


# ── Tokens ────────────────────────────────────────────────────────────────────


def test_tokens_requires_admin(client, user_headers):
    resp = client.get("/api/tokens", headers=user_headers)
    assert resp.status_code == 403


def test_tokens_create_and_revoke(client, admin_headers):
    resp = client.post(
        "/api/tokens",
        json={"name": "test-token", "scopes": ["read:ontology"]},
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert "full_token" in data
    assert data["full_token"].startswith("si_")
    tid = data["id"]

    resp = client.get("/api/tokens", headers=admin_headers)
    assert resp.status_code == 200
    ids = [t["id"] for t in resp.json()]
    assert tid in ids

    resp = client.delete(f"/api/tokens/{tid}", headers=admin_headers)
    assert resp.status_code == 204

    resp = client.get("/api/tokens", headers=admin_headers)
    ids_after = [t["id"] for t in resp.json()]
    assert tid not in ids_after


def test_tokens_create_name_too_long_422(client, admin_headers):
    resp = client.post(
        "/api/tokens",
        json={"name": "x" * 101, "scopes": ["read:ontology"]},
        headers=admin_headers,
    )
    assert resp.status_code == 422


def test_tokens_create_empty_name_422(client, admin_headers):
    resp = client.post(
        "/api/tokens",
        json={"name": "", "scopes": ["read:ontology"]},
        headers=admin_headers,
    )
    assert resp.status_code == 422


def test_tokens_create_invalid_scope_422(client, admin_headers):
    resp = client.post(
        "/api/tokens",
        json={"name": "test", "scopes": ["invalid:scope"]},
        headers=admin_headers,
    )
    assert resp.status_code == 422


# ── Notifications ─────────────────────────────────────────────────────────────


def test_notifications_requires_admin(client, user_headers):
    resp = client.get("/api/notifications/channels", headers=user_headers)
    assert resp.status_code == 403


def test_notifications_channel_lifecycle(client, admin_headers):
    resp = client.post(
        "/api/notifications/channels",
        json={"name": "test-slack", "channel_type": "slack", "destination": "#alerts"},
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    ch = resp.json()
    assert ch["name"] == "test-slack"
    cid = ch["id"]

    resp = client.patch(
        f"/api/notifications/channels/{cid}",
        json={"enabled": False},
        headers=admin_headers,
    )
    assert resp.status_code == 200

    resp = client.patch(
        f"/api/notifications/channels/{cid}",
        json={"name": "x" * 101},
        headers=admin_headers,
    )
    assert resp.status_code == 422

    # Rename and read back
    resp = client.patch(
        f"/api/notifications/channels/{cid}",
        json={"name": "renamed-channel"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    channels = client.get("/api/notifications/channels", headers=admin_headers).json()
    assert any(ch["name"] == "renamed-channel" for ch in channels)

    resp = client.delete(f"/api/notifications/channels/{cid}", headers=admin_headers)
    assert resp.status_code == 204


def test_notifications_channel_invalid_type_422(client, admin_headers):
    resp = client.post(
        "/api/notifications/channels",
        json={"name": "bad", "channel_type": "telegram", "destination": "#x"},
        headers=admin_headers,
    )
    assert resp.status_code == 422


def test_notifications_channel_empty_destination_422(client, admin_headers):
    resp = client.post(
        "/api/notifications/channels",
        json={"name": "ok", "channel_type": "email", "destination": ""},
        headers=admin_headers,
    )
    assert resp.status_code == 422


def test_notifications_channel_not_found_404(client, admin_headers):
    resp = client.delete(
        "/api/notifications/channels/does-not-exist", headers=admin_headers
    )
    assert resp.status_code == 404


def test_notifications_channel_oversized_id_422(client, admin_headers):
    resp = client.delete(
        f"/api/notifications/channels/{'x' * 65}", headers=admin_headers
    )
    assert resp.status_code == 422


def test_notifications_routing_update(client, admin_headers):
    resp = client.put(
        "/api/notifications/routing",
        json={"critical": ["ch-1", "ch-2"], "warning": [], "info": []},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_notifications_routing_too_many_ids_422(client, admin_headers):
    ids = [f"chan-{i}" for i in range(51)]
    resp = client.put(
        "/api/notifications/routing",
        json={"critical": ids, "warning": [], "info": []},
        headers=admin_headers,
    )
    assert resp.status_code == 422


def test_notifications_routing_get_returns_shape(client, admin_headers):
    resp = client.get("/api/notifications/routing", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert set(data.keys()) == {"critical", "warning", "info"}
    for key in ("critical", "warning", "info"):
        assert isinstance(data[key], list)
