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


def test_limit_clamp_applied_in_template_query(monkeypatch):
    """Template limit substitution clamps user-supplied limits to 1-100."""
    from app.semantic.layer import Intent

    layer = _make_minimal_layer()
    # Set up a template with a {limit} token
    layer._templates = [
        {
            "id": 1,
            "intent_type": "tpl_1",
            "name": "top_sp_template",
            "sql_query": "SELECT salesperson_ref, SUM(total_due) FROM sales_order_header GROUP BY salesperson_ref LIMIT {limit}",
            "keywords": ["top venditori"],
            "is_active": True,
            "sources": ["erp"],
        }
    ]
    executed_sql: list[str] = []

    def capture_execute(sql, params=()):
        executed_sql.append(sql)
        return []

    layer._mgr = MagicMock()
    layer._mgr.execute = capture_execute

    intent = Intent(
        intent_type="tpl_1",
        filters={"limit": 9999},
        raw_question="top venditori",
    )

    layer._execute_template_query(intent)

    assert executed_sql, "No SQL executed"
    # The clamped LIMIT (max 100) should appear in the SQL
    import re

    for sql in executed_sql:
        m = re.search(r"LIMIT\s+(\d+)", sql, re.IGNORECASE)
        if m:
            assert int(m.group(1)) <= 100, f"Limit not clamped: {m.group(1)}"


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


# ── ContextManager unit tests ────────────────────────────────────────────────


def test_context_manager_creates_session():
    from app.context.manager import ContextManager

    mgr = ContextManager()
    ctx = mgr.get_or_create("sess-1")
    assert ctx.session_id == "sess-1"
    assert ctx.history == []
    assert ctx.resolved_entities == {}


def test_context_manager_returns_same_session():
    from app.context.manager import ContextManager

    mgr = ContextManager()
    ctx1 = mgr.get_or_create("sess-same")
    ctx2 = mgr.get_or_create("sess-same")
    assert ctx1 is ctx2


def test_context_manager_auto_uuid_when_no_id():
    from app.context.manager import ContextManager

    mgr = ContextManager()
    ctx = mgr.get_or_create()
    assert len(ctx.session_id) == 36  # uuid4 format


def test_context_manager_update_records_history():
    from app.context.manager import ContextManager

    mgr = ContextManager()
    mgr.get_or_create("sess-h")
    mgr.update("sess-h", intent="q1", result="r1")
    mgr.update("sess-h", intent="q2", result="r2")
    ctx = mgr.get_or_create("sess-h")
    assert len(ctx.history) == 2
    assert ctx.history[0]["intent"] == "q1"


def test_context_manager_history_trimmed_to_max():
    from app.context.manager import ContextManager, _MAX_HISTORY

    mgr = ContextManager()
    mgr.get_or_create("sess-trim")
    for i in range(_MAX_HISTORY + 5):
        mgr.update("sess-trim", intent=f"q{i}", result=f"r{i}")
    ctx = mgr.get_or_create("sess-trim")
    assert len(ctx.history) == _MAX_HISTORY
    # most recent item is kept
    assert ctx.history[-1]["intent"] == f"q{_MAX_HISTORY + 4}"


def test_context_manager_remember_and_resolve():
    from app.context.manager import ContextManager

    mgr = ContextManager()
    mgr.get_or_create("sess-r")
    mgr.remember("sess-r", "fatturato", "revenue_with_tax")
    assert mgr.resolve("sess-r", "fatturato") == "revenue_with_tax"
    assert mgr.resolve("sess-r", "unknown") is None


def test_context_manager_resolve_unknown_session_returns_none():
    from app.context.manager import ContextManager

    mgr = ContextManager()
    assert mgr.resolve("no-such-session", "term") is None


def test_context_manager_drop_session():
    from app.context.manager import ContextManager

    mgr = ContextManager()
    mgr.get_or_create("sess-drop")
    assert mgr.drop_session("sess-drop") is True
    assert mgr.drop_session("sess-drop") is False
    assert "sess-drop" not in mgr.list_sessions()


def test_context_manager_eviction_at_capacity():
    """Sessions beyond _MAX_SESSIONS trigger LRU eviction of the oldest half."""
    from app.context.manager import ContextManager, _MAX_SESSIONS

    mgr = ContextManager()
    # Fill to capacity, ensuring distinct last_accessed timestamps
    for i in range(_MAX_SESSIONS):
        mgr.get_or_create(f"sess-{i}")
        # Force strictly increasing last_accessed without sleeping
        mgr._store[f"sess-{i}"].last_accessed = float(i)

    # The oldest half are sess-0 … sess-(_MAX_SESSIONS//2 - 1)
    # Adding one more triggers eviction
    mgr.get_or_create("sess-new")

    sessions = set(mgr.list_sessions())
    # Oldest half should be gone
    for i in range(_MAX_SESSIONS // 2):
        assert f"sess-{i}" not in sessions, f"sess-{i} should have been evicted"
    # Recent sessions and the new one should survive
    assert "sess-new" in sessions
    assert f"sess-{_MAX_SESSIONS - 1}" in sessions


def test_context_manager_eviction_update_is_noop_for_unknown():
    from app.context.manager import ContextManager

    mgr = ContextManager()
    # update on a non-existent session must not raise
    mgr.update("nonexistent", intent="x", result="y")


def test_context_manager_remember_is_noop_for_unknown():
    from app.context.manager import ContextManager

    mgr = ContextManager()
    mgr.remember("nonexistent", "term", "value")  # must not raise


# ── SemanticLayer docs-override paths ────────────────────────────────────────


def _make_layer_for_handler_tests():
    """Minimal SemanticLayer with thread-local initialised."""
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
    # Initialise the thread-local slot used by _effective_docs
    if not hasattr(SemanticLayer._thread_local, "docs"):
        SemanticLayer._thread_local.docs = None
    return layer


def test_q_glossary_lookup_with_docs_override():
    """_q_glossary_lookup returns definition from docs when docs are provided."""
    from app.semantic.layer import Intent
    from app.semantic.doc_schema import GlossaryTerm, SemanticDocs

    layer = _make_layer_for_handler_tests()
    from app.semantic.layer import SemanticLayer

    SemanticLayer._thread_local.docs = SemanticDocs(
        glossary=[
            GlossaryTerm(term="fatturato", definition="Total billed revenue"),
            GlossaryTerm(term="ordine", definition="Sales order"),
        ]
    )
    try:
        intent = Intent(
            intent_type="glossary_lookup",
            raw_question="fatturato?",
            filters={"term": "fatturato"},
        )
        result = layer._q_glossary_lookup(intent)
        assert result.answer == "Total billed revenue"
    finally:
        SemanticLayer._thread_local.docs = None


def test_q_glossary_lookup_with_docs_partial_match():
    """_q_glossary_lookup falls back to partial match when exact match misses."""
    from app.semantic.layer import Intent
    from app.semantic.doc_schema import GlossaryTerm, SemanticDocs

    layer = _make_layer_for_handler_tests()
    from app.semantic.layer import SemanticLayer

    SemanticLayer._thread_local.docs = SemanticDocs(
        glossary=[
            GlossaryTerm(term="fatturato lordo", definition="Gross billed revenue")
        ]
    )
    try:
        intent = Intent(
            intent_type="glossary_lookup",
            raw_question="fatturato",
            filters={"term": "fatturato"},
        )
        result = layer._q_glossary_lookup(intent)
        assert "Gross billed revenue" in result.answer
    finally:
        SemanticLayer._thread_local.docs = None


def test_q_glossary_lookup_unknown_term_lists_available():
    """_q_glossary_lookup includes available terms when the term is not found."""
    from app.semantic.layer import Intent
    from app.semantic.doc_schema import GlossaryTerm, SemanticDocs

    layer = _make_layer_for_handler_tests()
    from app.semantic.layer import SemanticLayer

    SemanticLayer._thread_local.docs = SemanticDocs(
        glossary=[GlossaryTerm(term="fatturato", definition="Revenue")]
    )
    try:
        intent = Intent(
            intent_type="glossary_lookup", raw_question="xyz", filters={"term": "xyz"}
        )
        result = layer._q_glossary_lookup(intent)
        assert "fatturato" in result.answer
        assert "not present" in result.answer.lower() or "xyz" in result.answer
    finally:
        SemanticLayer._thread_local.docs = None


def test_q_disambiguation_rules_with_docs():
    """_q_disambiguation_rules returns rules from docs when available."""
    from app.semantic.layer import Intent
    from app.semantic.doc_schema import DisambiguationRule, SemanticDocs

    layer = _make_layer_for_handler_tests()
    from app.semantic.layer import SemanticLayer

    SemanticLayer._thread_local.docs = SemanticDocs(
        disambiguation_rules=[
            DisambiguationRule(id="r1", name="Rule One", description="Test rule"),
        ]
    )
    try:
        intent = Intent(intent_type="disambiguation_rules", raw_question="rules")
        result = layer._q_disambiguation_rules(intent)
        assert isinstance(result.answer, list)
        assert len(result.answer) == 1
        assert result.answer[0]["rule_id"] == "r1"
    finally:
        SemanticLayer._thread_local.docs = None


def test_q_certified_metrics_with_docs_certified_filter():
    """_q_certified_metrics returns only certified=True metrics from docs."""
    from app.semantic.layer import Intent
    from app.semantic.doc_schema import MetricDoc, SemanticDocs

    layer = _make_layer_for_handler_tests()
    from app.semantic.layer import SemanticLayer

    SemanticLayer._thread_local.docs = SemanticDocs(
        metrics=[
            MetricDoc(name="revenue", display_name="Revenue", certified=True),
            MetricDoc(name="draft_metric", display_name="Draft", certified=False),
        ]
    )
    try:
        intent = Intent(
            intent_type="certified_metrics", raw_question="certified metrics"
        )
        result = layer._q_certified_metrics(intent)
        assert isinstance(result.answer, list)
        # Only the certified one should appear
        names = [m["name"] for m in result.answer]
        assert "revenue" in names
        assert "draft_metric" not in names
    finally:
        SemanticLayer._thread_local.docs = None


# ── Saved queries CRUD ────────────────────────────────────────────────────────


def test_saved_queries_crud(auth_client, tmp_path, monkeypatch):
    """Full CRUD cycle for /api/queries/saved."""
    import app.main as m

    monkeypatch.setattr(m, "_QUERIES_DB_PATH", tmp_path / "q.db")

    client, headers = auth_client
    sector = "manufacturing"
    qid = "test-id-001"

    # List when empty
    r = client.get(f"/api/queries/saved?sector_id={sector}", headers=headers)
    assert r.status_code == 200
    assert r.json() == []

    # Save a query
    payload = {
        "id": qid,
        "sector_id": sector,
        "query": "What is the revenue by product?",
        "created_at": "2024-01-01T00:00:00",
    }
    r = client.post("/api/queries/saved", json=payload, headers=headers)
    assert r.status_code == 201
    assert r.json()["id"] == qid

    # List now returns it
    r = client.get(f"/api/queries/saved?sector_id={sector}", headers=headers)
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert items[0]["query"] == "What is the revenue by product?"

    # Idempotent upsert (same id, different query text)
    payload2 = {**payload, "query": "Updated question"}
    r = client.post("/api/queries/saved", json=payload2, headers=headers)
    assert r.status_code == 201

    r = client.get(f"/api/queries/saved?sector_id={sector}", headers=headers)
    assert r.json()[0]["query"] == "Updated question"

    # Delete
    r = client.delete(f"/api/queries/saved/{qid}", headers=headers)
    assert r.status_code == 204

    # Gone
    r = client.get(f"/api/queries/saved?sector_id={sector}", headers=headers)
    assert r.json() == []


def test_saved_queries_require_auth(auth_client):
    """Saved queries endpoints reject unauthenticated requests."""
    client, _ = auth_client
    assert client.get("/api/queries/saved?sector_id=x").status_code == 401
    assert client.post("/api/queries/saved", json={}).status_code == 401
    assert client.delete("/api/queries/saved/x").status_code == 401


# ── Custom agents CRUD ────────────────────────────────────────────────────────


def test_custom_agents_crud(auth_client, tmp_path, monkeypatch):
    """Full CRUD cycle for /api/agents/custom."""
    import app.main as m

    monkeypatch.setattr(m, "_AGENTS_DB_PATH", tmp_path / "a.db")

    client, headers = auth_client
    sector = "manufacturing"

    # List when empty
    r = client.get(f"/api/agents/custom?sector_id={sector}", headers=headers)
    assert r.status_code == 200
    assert r.json() == []

    # Create
    agent = {
        "id": "agent-001",
        "sector_id": sector,
        "name": "Test Agent",
        "description": "A test agent",
        "template": "monitor",
        "entities": ["Customer"],
        "findings": [],
        "actions": [],
        "trigger": {"kind": "manual"},
    }
    r = client.post("/api/agents/custom", json=agent, headers=headers)
    assert r.status_code == 201
    assert r.json()["name"] == "Test Agent"

    # List
    r = client.get(f"/api/agents/custom?sector_id={sector}", headers=headers)
    assert len(r.json()) == 1

    # Update
    r = client.put(
        "/api/agents/custom/agent-001",
        json={**agent, "name": "Updated"},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Updated"

    # Update non-existent
    r = client.put("/api/agents/custom/no-such", json=agent, headers=headers)
    assert r.status_code == 404

    # Delete
    r = client.delete("/api/agents/custom/agent-001", headers=headers)
    assert r.status_code == 204

    r = client.get(f"/api/agents/custom?sector_id={sector}", headers=headers)
    assert r.json() == []


def test_custom_agents_require_auth(auth_client):
    """Custom agents endpoints reject unauthenticated requests."""
    client, _ = auth_client
    assert client.get("/api/agents/custom?sector_id=x").status_code == 401
    assert client.post("/api/agents/custom", json={}).status_code == 401
    assert client.put("/api/agents/custom/x", json={}).status_code == 401
    assert client.delete("/api/agents/custom/x").status_code == 401


# ── LLM provider selection ────────────────────────────────────────────────────


def test_llm_provider_anthropic_default_groq_fallback(monkeypatch):
    """Anthropic wins when both keys are set; FRA_LLM_PROVIDER forces a
    provider only if its key exists; no keys → None."""
    import app.semantic.layer as layer_mod

    monkeypatch.delenv("FRA_LLM_PROVIDER", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "a-key")
    monkeypatch.setenv("GROQ_API_KEY", "g-key")
    assert layer_mod._llm_intent_provider() == "anthropic"

    monkeypatch.setenv("FRA_LLM_PROVIDER", "groq")
    assert layer_mod._llm_intent_provider() == "groq"

    # Forced provider without its key falls back to whatever is configured.
    monkeypatch.setenv("FRA_LLM_PROVIDER", "anthropic")
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    assert layer_mod._llm_intent_provider() == "groq"

    monkeypatch.delenv("FRA_LLM_PROVIDER")
    monkeypatch.delenv("GROQ_API_KEY")
    assert layer_mod._llm_intent_provider() is None
