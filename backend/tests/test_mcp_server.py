"""Tests for the MCP server (mcp_server.py).

Unit-tests the JSON-RPC handler (initialize / tools.list / errors) and the
tool registry, plus an integration check via TestClient (auth required).
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

from app.mcp_server import _TOOL_NAMES, _TOOLS, handle_jsonrpc


# ── Unit: JSON-RPC handler (no HTTP, no auth) ─────────────────────────────────


class TestJsonRpc:
    def test_tool_registry_shape(self):
        assert _TOOL_NAMES == {"ask", "list_metrics", "get_data_model"}
        for t in _TOOLS:
            assert t["inputSchema"]["type"] == "object"
            assert t["name"] and t["description"]

    def test_initialize(self):
        resp = handle_jsonrpc(
            {"jsonrpc": "2.0", "id": 1, "method": "initialize"}, None, None
        )
        assert resp["id"] == 1
        assert resp["result"]["serverInfo"]["name"] == "fra-semantic-layer"
        assert "tools" in resp["result"]["capabilities"]

    def test_tools_list(self):
        resp = handle_jsonrpc(
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, None, None
        )
        names = {t["name"] for t in resp["result"]["tools"]}
        assert names == _TOOL_NAMES

    def test_notification_returns_none(self):
        assert (
            handle_jsonrpc(
                {"jsonrpc": "2.0", "method": "notifications/initialized"}, None, None
            )
            is None
        )

    def test_unknown_method_errors(self):
        resp = handle_jsonrpc(
            {"jsonrpc": "2.0", "id": 3, "method": "bogus"}, None, None
        )
        assert resp["error"]["code"] == -32601

    def test_unknown_tool_errors(self):
        resp = handle_jsonrpc(
            {
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {"name": "nope", "arguments": {}},
            },
            None,
            None,
        )
        assert resp["error"]["code"] == -32602


# ── Integration: endpoint auth ────────────────────────────────────────────────


def _hash_pw(pw: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 120_000)
    return f"pbkdf2_sha256$120000${salt}${base64.b64encode(digest).decode()}"


@pytest.fixture(scope="module")
def _env():
    users = [
        {
            "username": "mcp_u",
            "password_hash": _hash_pw("mcp_pw"),
            "role": "user",
            "disabled": False,
        }
    ]
    os.environ["AUTH_USERS_JSON"] = json.dumps(users)
    os.environ["JWT_SECRET_KEY"] = "mcp-server-test-secret-32chars!!!!"
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
        "/api/auth/token", data={"username": "mcp_u", "password": "mcp_pw"}
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


class TestEndpoint:
    def test_requires_auth(self, client):
        resp = client.post(
            "/api/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
        )
        assert resp.status_code == 401

    def test_tools_list_authenticated(self, client, headers):
        resp = client.post(
            "/api/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        names = {t["name"] for t in resp.json()["result"]["tools"]}
        assert names == _TOOL_NAMES

    def test_get_data_model_tool(self, client, headers):
        resp = client.post(
            "/api/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": "get_data_model", "arguments": {}},
            },
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        result = resp.json()["result"]
        assert result["isError"] is False
        assert "entities" in result["structuredContent"]
