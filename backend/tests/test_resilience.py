"""Tests for retry logic, docs_override isolation, limit bounds, and auth guards."""

from __future__ import annotations

import json
import os
import threading
from unittest.mock import MagicMock, patch

import pytest


# ── Groq retry logic ──────────────────────────────────────────────────────────


def test_groq_retries_on_429_then_succeeds(monkeypatch):
    """Three 429s followed by success: first two sleep+retry, third succeeds."""
    import app.semantic.layer as layer_mod

    call_count = 0

    def fake_post(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        resp = MagicMock()
        if call_count < 3:
            resp.status_code = 429
            resp.raise_for_status.side_effect = Exception("429 Rate Limited")
        else:
            resp.status_code = 200
            resp.raise_for_status.return_value = None
            resp.json.return_value = {
                "choices": [{"message": {"content": '{"intent_type":"count_orders"}'}}]
            }
        return resp

    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    slept = []
    monkeypatch.setattr("time.sleep", lambda s: slept.append(s))

    with patch("httpx.post", side_effect=fake_post):
        result = layer_mod._complete_json_via_groq("sys", "user")

    assert call_count == 3
    assert result == '{"intent_type":"count_orders"}'
    # Back-off schedule: 1s then 2s (2**0 and 2**1)
    assert slept == [1, 2]


def test_groq_exhausts_retries_raises_on_third_429(monkeypatch):
    """All three attempts return 429 — raise_for_status is called on the last."""
    import app.semantic.layer as layer_mod

    def fake_post(*args, **kwargs):
        resp = MagicMock()
        resp.status_code = 429
        resp.raise_for_status.side_effect = Exception("429 Rate Limited")
        return resp

    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setattr("time.sleep", lambda s: None)

    with patch("httpx.post", side_effect=fake_post):
        with pytest.raises(Exception, match="429"):
            layer_mod._complete_json_via_groq("sys", "user")


def test_groq_non_429_raises_immediately(monkeypatch):
    """A 500 error should raise immediately without sleeping or retrying."""
    import app.semantic.layer as layer_mod

    call_count = 0

    def fake_post(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        resp = MagicMock()
        resp.status_code = 500
        resp.raise_for_status.side_effect = Exception("500 Internal Server Error")
        return resp

    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    slept = []
    monkeypatch.setattr("time.sleep", lambda s: slept.append(s))

    with patch("httpx.post", side_effect=fake_post):
        with pytest.raises(Exception, match="500"):
            layer_mod._complete_json_via_groq("sys", "user")

    assert call_count == 1  # No retry on non-429
    assert slept == []  # No sleep on non-429


# ── docs_override thread isolation ────────────────────────────────────────────


def _make_minimal_layer():
    """Build a SemanticLayer without connectors for unit tests."""
    from app.semantic.layer import SemanticLayer

    layer = SemanticLayer.__new__(SemanticLayer)
    layer._docs = None
    layer._parser = MagicMock()
    layer._ontology = MagicMock()
    layer._kg = MagicMock()
    layer._catalog = MagicMock()
    layer._ctx_mgr = None
    layer._erp = MagicMock()
    layer._crm = MagicMock()
    layer._hr_pim = MagicMock()
    return layer


def test_thread_local_cleared_after_ask(monkeypatch):
    """_thread_local.docs is reset to None after ask() returns."""
    from app.semantic.layer import SemanticLayer

    layer = _make_minimal_layer()

    fake_docs = MagicMock()
    fake_docs.entities = []
    fake_docs.glossary = []
    fake_docs.metrics = []
    fake_docs.disambiguation_rules = []

    # Patch _resolve to return a trivial Result immediately
    from app.semantic.layer import Result

    layer._resolve = MagicMock(return_value=Result(answer="ok"))

    layer.ask("test", docs_override=fake_docs)
    assert SemanticLayer._thread_local.docs is None


def test_thread_local_cleared_even_on_exception(monkeypatch):
    """_thread_local.docs is reset to None even when _resolve raises."""
    from app.semantic.layer import AmbiguityError, SemanticLayer

    layer = _make_minimal_layer()
    layer._resolve = MagicMock(side_effect=AmbiguityError("amb", ["a", "b"]))

    fake_docs = MagicMock()
    with pytest.raises(AmbiguityError):
        layer.ask("test", docs_override=fake_docs)

    assert SemanticLayer._thread_local.docs is None


def test_two_threads_see_independent_docs():
    """Concurrent requests on different threads never see each other's docs."""
    from app.semantic.layer import Result, SemanticLayer

    layer = _make_minimal_layer()
    results = {}
    errors = []

    docs_a = MagicMock()
    docs_a.name = "A"
    docs_b = MagicMock()
    docs_b.name = "B"

    def run(label, docs):
        try:
            seen = []

            def fake_resolve(q, ctx):
                import time

                time.sleep(0.02)  # let the other thread set its docs
                seen.append(SemanticLayer._thread_local.docs)
                return Result(answer="ok")

            layer._resolve = fake_resolve
            layer.ask("q", docs_override=docs)
            results[label] = seen[0]
        except Exception as e:
            errors.append(e)

    t1 = threading.Thread(target=run, args=("A", docs_a))
    t2 = threading.Thread(target=run, args=("B", docs_b))
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert not errors
    # Each thread should only have seen its own docs (thread-local isolation)
    if "A" in results:
        assert results["A"] is docs_a
    if "B" in results:
        assert results["B"] is docs_b


# ── limit bounds ──────────────────────────────────────────────────────────────


def test_limit_clamp_applied_in_top_salespersons(monkeypatch):
    """User-supplied limit=9999 is clamped to ≤50 before SQL execution."""
    from app.semantic.layer import Intent

    layer = _make_minimal_layer()

    executed_limits = []

    def capture_execute(sql, *args, **kwargs):
        # Extract the LIMIT value from the SQL string
        import re

        m = re.search(r"LIMIT\s+(\d+)", sql, re.IGNORECASE)
        if m:
            executed_limits.append(int(m.group(1)))
        return []

    layer._erp.execute_query = capture_execute
    layer._hr_pim.execute_query = MagicMock(return_value=[])

    intent = Intent(
        intent_type="top_salespersons_by_revenue",
        limit=9999,
        raw_question="top salespeople",
    )

    layer._q_top_salespersons_by_revenue(intent)

    assert all(lim <= 50 for lim in executed_limits), (
        f"Limit not clamped: {executed_limits}"
    )


# ── auth on semantic CRUD endpoints ──────────────────────────────────────────


@pytest.fixture(scope="module")
def _auth_env():
    import base64
    import hashlib
    import secrets

    def _hash(pw):
        salt = secrets.token_hex(16)
        digest = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 120_000)
        return f"pbkdf2_sha256$120000${salt}${base64.b64encode(digest).decode()}"

    users = [
        {
            "username": "u",
            "password_hash": _hash("pw"),
            "role": "user",
            "disabled": False,
        }
    ]
    os.environ["AUTH_USERS_JSON"] = json.dumps(users)
    os.environ["JWT_SECRET_KEY"] = "resilience-test-secret"
    os.environ["SEMANTIC_REQUIRE_LLM_INTENT"] = "0"


@pytest.fixture(scope="module")
def auth_client(_auth_env):
    import sys

    sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent.parent))
    import app.main as m

    limiter = getattr(m.app.state, "limiter", None)
    if limiter:
        limiter.enabled = False
    from fastapi.testclient import TestClient

    with TestClient(m.app) as c:
        resp = c.post("/api/auth/token", data={"username": "u", "password": "pw"})
        token = resp.json()["access_token"]
        yield c, {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/semantic/sources"),
        ("get", "/api/semantic/metrics"),
        ("get", "/api/semantic/hierarchies"),
        ("get", "/api/semantic/segments"),
        ("get", "/api/semantic/coverage"),
    ],
)
def test_semantic_read_endpoints_require_auth(auth_client, method, path):
    """Unauthenticated requests to semantic read endpoints return 401."""
    client, _ = auth_client
    fn = getattr(client, method)
    resp = fn(path)
    assert resp.status_code == 401, (
        f"{method.upper()} {path} returned {resp.status_code}"
    )


@pytest.mark.parametrize(
    "method,path,body",
    [
        (
            "post",
            "/api/semantic/metrics",
            {
                "sector_id": "x",
                "name": "n",
                "description": "",
                "type": "sum",
                "entity": "E",
                "field": "f",
                "numerator": "",
                "denominator": "",
                "expression": "",
                "filters": [],
                "time_dimension": "",
                "grains": [],
                "format": "number",
                "status": "draft",
                "owner": "",
                "tags": [],
            },
        ),
        ("delete", "/api/semantic/metrics/nonexistent", None),
        (
            "post",
            "/api/semantic/hierarchies",
            {
                "sector_id": "x",
                "name": "n",
                "entity": "E",
                "description": "",
                "type": "categorical",
                "levels": [],
            },
        ),
        ("delete", "/api/semantic/hierarchies/nonexistent", None),
        (
            "post",
            "/api/semantic/segments",
            {
                "sector_id": "x",
                "name": "n",
                "description": "",
                "entity": "E",
                "conditions": [],
                "tags": [],
                "used_by": [],
            },
        ),
        ("delete", "/api/semantic/segments/nonexistent", None),
    ],
)
def test_semantic_write_endpoints_require_auth(auth_client, method, path, body):
    """Unauthenticated requests to semantic write endpoints return 401."""
    client, _ = auth_client
    fn = getattr(client, method)
    resp = fn(path, json=body) if body else fn(path)
    assert resp.status_code == 401, (
        f"{method.upper()} {path} returned {resp.status_code}"
    )


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/context/documents"),
        ("get", "/api/context/entities"),
        ("get", "/api/context/metrics"),
        ("get", "/api/context/glossary"),
        ("get", "/api/context/search?q=test"),
    ],
)
def test_context_read_endpoints_require_auth(auth_client, method, path):
    """Unauthenticated requests to context read endpoints return 401."""
    client, _ = auth_client
    resp = getattr(client, method)(path)
    assert resp.status_code == 401, (
        f"{method.upper()} {path} returned {resp.status_code}"
    )
