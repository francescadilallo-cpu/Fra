"""Regression tests for semantic cache behavior and invalidation hooks."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import threading
from collections import OrderedDict
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).parent.parent


def _password_hash(password: str, iterations: int = 120_000) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations
    )
    return (
        f"pbkdf2_sha256${iterations}${salt}${base64.b64encode(digest).decode('ascii')}"
    )


@pytest.fixture(scope="session", autouse=True)
def _test_auth_env() -> None:
    users = [
        {
            "username": "cache_admin",
            "password_hash": _password_hash("cache_password"),
            "role": "admin",
            "disabled": False,
        }
    ]
    os.environ["AUTH_USERS_JSON"] = json.dumps(users)
    os.environ["JWT_SECRET_KEY"] = "cache-test-secret-key-not-for-production"
    os.environ["SEMANTIC_REQUIRE_LLM_INTENT"] = "0"


@pytest.fixture(scope="session")
def app_module():
    import sys

    sys.path.insert(0, str(ROOT))
    import app.main as main_module

    limiter = getattr(main_module.app.state, "limiter", None)
    if limiter is not None:
        setattr(limiter, "enabled", False)
    return main_module


@pytest.fixture(scope="session")
def client(app_module) -> TestClient:
    with TestClient(app_module.app) as c:
        yield c


@pytest.fixture(scope="session")
def auth_headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/auth/token",
        data={"username": "cache_admin", "password": "cache_password"},
    )
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_validation_plan_cache_skips_repeated_ontology_validation(app_module) -> None:
    from app.semantic.layer import (
        Intent,
        NeuroSymbolicPlan,
        OntologyIntentMapping,
        SemanticLayer,
    )

    if not hasattr(SemanticLayer, "_get_or_build_cached_plan"):
        pytest.skip(
            "Semantic plan cache not available in current SemanticLayer implementation"
        )

    layer = SemanticLayer.__new__(SemanticLayer)
    layer._validation_cache_lock = threading.RLock()
    layer._validation_cache = OrderedDict()
    layer._validation_cache_maxsize = 64

    calls = {"count": 0}

    def wrapped(*args, **kwargs):
        calls["count"] += 1
        return NeuroSymbolicPlan(
            intent_type="count_orders",
            metric="order_count",
            entities=["SalesOrder"],
            properties=["order_id"],
            relations=[],
            connectors=["erp"],
            tables=["sales_order_header"],
            validation_steps=["mocked"],
        )

    layer._build_validated_plan = wrapped

    intent = Intent(
        intent_type="count_orders",
        filters={"country": "US"},
        dimensions=[],
        limit=None,
        year=2014,
        raw_question="Quanti ordini abbiamo nel 2014?",
    )
    mapping = OntologyIntentMapping(
        intent_type="count_orders",
        metric="order_count",
        entities=["SalesOrder"],
        properties=["order_id"],
        relations=[],
        filters={"country": "US"},
        model="test-model",
    )

    _ = layer._get_or_build_cached_plan(
        intent, mapping, context={"tenant": "perf-demo"}
    )
    _ = layer._get_or_build_cached_plan(
        intent, mapping, context={"tenant": "perf-demo"}
    )

    assert calls["count"] == 1


def test_cache_namespace_is_bumped_on_mapping_update(
    client: TestClient,
    auth_headers: dict[str, str],
    app_module,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class DummyLayer:
        def __init__(self) -> None:
            self.clears = 0

        def clear_semantic_cache(self) -> None:
            self.clears += 1

    layer = DummyLayer()
    monkeypatch.setattr(app_module, "_semantic_cache_namespace", 0)
    monkeypatch.setitem(app_module._semantic_state, "loaded", True)
    monkeypatch.setitem(app_module._semantic_state, "layer", layer)
    monkeypatch.setattr(
        app_module, "update_mapping", lambda table, field, ontology_path: True
    )

    response = client.put(
        "/api/ontology/mappings",
        json={
            "table": "sales_order_header",
            "field": "order_date",
            "ontology_path": "SalesOrder.order_date",
        },
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    assert layer.clears == 1
    assert app_module._semantic_cache_namespace == 1


def test_cache_namespace_is_bumped_on_kg_rebuild(
    client: TestClient,
    auth_headers: dict[str, str],
    app_module,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class DummyLayer:
        def __init__(self) -> None:
            self.clears = 0

        def clear_semantic_cache(self) -> None:
            self.clears += 1

    class DummyKG:
        node_count = 0
        edge_count = 0
        dedup_count = 0

    class DummyCatalog:
        def row_count(self) -> int:
            return 0

        def list_entities(self) -> list[str]:
            return []

    layer = DummyLayer()
    monkeypatch.setattr(app_module, "_semantic_cache_namespace", 0)
    monkeypatch.setitem(app_module._semantic_state, "loaded", True)
    monkeypatch.setitem(app_module._semantic_state, "layer", layer)

    def _fake_ensure_semantic_loaded() -> None:
        app_module._semantic_state.update(
            {
                "loaded": True,
                "layer": DummyLayer(),
                "ontology": object(),
                "kg": DummyKG(),
                "catalog": DummyCatalog(),
            }
        )

    monkeypatch.setattr(
        app_module, "_ensure_semantic_loaded", _fake_ensure_semantic_loaded
    )

    response = client.post("/api/kg/build", headers=auth_headers)

    assert response.status_code == 200, response.text
    assert layer.clears == 1
    assert app_module._semantic_cache_namespace == 1


def test_cache_namespace_is_bumped_on_full_semantic_rebuild(
    client: TestClient,
    auth_headers: dict[str, str],
    app_module,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """POST /api/semantic/build?force=true → reload_semantic() swaps in a
    brand-new SemanticLayer instance (plus fresh ontology/catalog/KG/
    templates) — the most thorough kind of semantic-stack mutation there is.
    Every answer cached under the old generation reflects the OLD stack; it
    must stop being served immediately, exactly like the narrower mutations
    (mapping update, KG rebuild, metric/context-doc/template edits) already
    do — a full rebuild invalidating *less* than its own sub-parts would be
    a regression, not an oversight worth tolerating.

    Without force, a POST on an already-loaded stack is a fast no-op: the
    layer instance and the cache namespace must stay untouched, because no
    rebuild happened and cached answers are still valid."""

    class DummyLayer:
        def __init__(self) -> None:
            self.clears = 0

        def clear_semantic_cache(self) -> None:
            self.clears += 1

        def set_context_docs(self, docs: list[dict]) -> None:
            pass

        def set_templates(self, templates: list[dict]) -> None:
            pass

    class DummyCatalog:
        def list_templates(self) -> list[dict]:
            return []

        def upsert_auto_templates(self, tpls: list[dict]) -> int:
            return 0

    old_layer = DummyLayer()
    new_layer = DummyLayer()
    monkeypatch.setattr(app_module, "_semantic_cache_namespace", 0)
    monkeypatch.setitem(app_module._semantic_state, "loaded", True)
    monkeypatch.setitem(app_module._semantic_state, "layer", old_layer)
    monkeypatch.setitem(app_module._semantic_state, "catalog", DummyCatalog())

    def _fake_ensure_semantic_loaded() -> None:
        # Mirrors what the real rebuild does: a brand-new layer/catalog
        # replace the old ones wholesale (atomic dict-item reassignment).
        app_module._semantic_state.update(
            {"loaded": True, "layer": new_layer, "catalog": DummyCatalog()}
        )

    monkeypatch.setattr(
        app_module, "_ensure_semantic_loaded", _fake_ensure_semantic_loaded
    )
    monkeypatch.setattr(app_module, "_sync_context_docs_to_layer", lambda: None)
    monkeypatch.setattr(
        app_module,
        "_get_semantic_draft",
        lambda hidden=frozenset(): {"entities": [], "metrics": [], "relations": []},
    )
    monkeypatch.setattr(app_module, "generate_templates_from_draft", lambda draft: [])

    # Already loaded + no force → fast path: no rebuild, no invalidation.
    response = client.post("/api/semantic/build", headers=auth_headers)

    assert response.status_code == 200, response.text
    assert app_module._semantic_state["layer"] is old_layer, (
        "without force, an already-loaded stack must not be rebuilt — the "
        "fast path exists precisely to skip the expensive reload"
    )
    assert app_module._semantic_cache_namespace == 0, (
        "no rebuild happened, so cached answers are still valid and the "
        "namespace must not be bumped"
    )

    # force=true → full rebuild: layer swapped, cache invalidated.
    response = client.post(
        "/api/semantic/build", params={"force": "true"}, headers=auth_headers
    )

    assert response.status_code == 200, response.text
    assert app_module._semantic_state["layer"] is new_layer, (
        "test setup sanity check — the rebuild must have actually swapped "
        "in the new layer instance for the assertions below to mean anything"
    )
    assert app_module._semantic_cache_namespace == 1, (
        "a full rebuild replaces the entire semantic stack — a cached "
        "pre-rebuild answer must not keep being served as if nothing changed"
    )
    assert new_layer.clears == 1
    assert old_layer.clears == 0


class TestCacheNamespaceIsBumpedOnSemanticEditorMutations:
    """update_ontology_mapping/rebuild_knowledge_graph/agentic write-backs all
    bump the cache namespace because they change what layer.ask() returns for
    a given question. Three other mutation surfaces feed layer.ask() through
    the exact same channels — catalog.list_metric_objects() (metric-definition
    answers), layer._context_docs (the LLM SQL-generation prompt, pushed via
    _sync_context_docs_to_layer/set_context_docs), and layer._templates
    (deterministic tpl_<id> intents, pushed via _hot_reload_templates/
    set_templates) — yet their endpoints never invalidated the cache, so a
    pre-edit cached answer kept being served (citing the old metric formula,
    ignoring new/removed business context, skipping the new/changed/removed
    template) until the entry expired or got evicted."""

    class _DummyLayer:
        def __init__(self) -> None:
            self.clears = 0

        def clear_semantic_cache(self) -> None:
            self.clears += 1

        def set_context_docs(self, docs: list[dict]) -> None:
            pass

        def set_templates(self, templates: list[dict]) -> None:
            pass

    def test_metric_draft_update(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        app_module,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        class DummyCatalog:
            def save_metric_draft(self, name, **_kwargs) -> bool:
                return True

        layer = self._DummyLayer()
        monkeypatch.setattr(app_module, "_semantic_cache_namespace", 0)
        monkeypatch.setitem(app_module._semantic_state, "loaded", True)
        monkeypatch.setitem(app_module._semantic_state, "layer", layer)
        monkeypatch.setitem(app_module._semantic_state, "catalog", DummyCatalog())

        response = client.patch(
            "/api/semantic/draft/metrics/order_count",
            json={"description": "Conteggio ordini aggiornato"},
            headers=auth_headers,
        )

        assert response.status_code == 200, response.text
        assert layer.clears == 1
        assert app_module._semantic_cache_namespace == 1

    def test_context_doc_add_and_delete(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        app_module,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.connectors.source_registry import get_source_registry

        layer = self._DummyLayer()
        monkeypatch.setattr(app_module, "_semantic_cache_namespace", 0)
        monkeypatch.setitem(app_module._semantic_state, "loaded", True)
        monkeypatch.setitem(app_module._semantic_state, "layer", layer)

        create = client.post(
            "/api/semantic/draft/context",
            json={
                "title": "cache-bump-regression-doc",
                "content": "Revenue excludes intercompany transfers.",
            },
            headers=auth_headers,
        )
        assert create.status_code == 201, create.text
        doc_id = create.json()["id"]
        try:
            assert app_module._semantic_cache_namespace == 1, (
                "adding a context doc changes the LLM SQL-generation prompt — "
                "a cached pre-edit answer must stop being served immediately"
            )
            assert layer.clears == 1

            delete = client.delete(
                f"/api/semantic/draft/context/{doc_id}", headers=auth_headers
            )
            assert delete.status_code == 200, delete.text
            assert app_module._semantic_cache_namespace == 2, (
                "removing a context doc must also invalidate cached answers "
                "that were generated while it was still part of the prompt"
            )
            assert layer.clears == 2
        finally:
            registry = get_source_registry()
            if registry.get(doc_id) is not None:
                registry.remove(doc_id)

    def test_template_create_update_delete(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        app_module,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        class DummyCatalog:
            def __init__(self) -> None:
                self._next_id = 1
                self._templates: dict[int, dict] = {}

            def create_template(self, **kwargs) -> dict:
                tid = self._next_id
                self._next_id += 1
                tpl = {"id": tid, **kwargs}
                self._templates[tid] = tpl
                return dict(tpl)

            def update_template(self, template_id: int, **kwargs) -> dict:
                if template_id not in self._templates:
                    raise KeyError(f"Template {template_id} not found")
                self._templates[template_id].update(kwargs)
                return dict(self._templates[template_id])

            def delete_template(self, template_id: int) -> None:
                if template_id not in self._templates:
                    raise KeyError(f"Template {template_id} not found")
                del self._templates[template_id]

            def list_templates(self) -> list[dict]:
                return [dict(t) for t in self._templates.values()]

        layer = self._DummyLayer()
        monkeypatch.setattr(app_module, "_semantic_cache_namespace", 0)
        monkeypatch.setitem(app_module._semantic_state, "loaded", True)
        monkeypatch.setitem(app_module._semantic_state, "layer", layer)
        monkeypatch.setitem(app_module._semantic_state, "catalog", DummyCatalog())

        create = client.post(
            "/api/semantic/templates",
            json={
                "name": "cache-bump-regression-template",
                "sql_query": "SELECT 1 AS one",
                "keywords": ["bump"],
            },
            headers=auth_headers,
        )
        assert create.status_code == 201, create.text
        tid = create.json()["id"]
        assert app_module._semantic_cache_namespace == 1, (
            "a new template can deterministically answer questions it "
            "matches — a cached pre-creation answer must not keep skipping it"
        )
        assert layer.clears == 1

        update = client.patch(
            f"/api/semantic/templates/{tid}",
            json={"description": "updated description"},
            headers=auth_headers,
        )
        assert update.status_code == 200, update.text
        assert app_module._semantic_cache_namespace == 2, (
            "editing a template's SQL/keywords changes what layer.ask() "
            "returns for matching questions"
        )
        assert layer.clears == 2

        delete = client.delete(f"/api/semantic/templates/{tid}", headers=auth_headers)
        assert delete.status_code == 204, delete.text
        assert app_module._semantic_cache_namespace == 3, (
            "deleting a template must stop cached answers from keeping its "
            "(now-removed) deterministic behavior alive"
        )
        assert layer.clears == 3


def test_semantic_ask_redis_cache_short_circuits_repeated_layer_execution(
    client: TestClient,
    auth_headers: dict[str, str],
    app_module,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeRedis:
        def __init__(self) -> None:
            self.storage: dict[str, str] = {}

        def get(self, key: str) -> str | None:
            return self.storage.get(key)

        def setex(self, key: str, _ttl: int, value: str) -> None:
            self.storage[key] = value

    calls = {"count": 0}

    class DummyLayer:
        def ask(
            self,
            question: str,
            context: dict[str, str],
            docs_override=None,
            hidden_tables=frozenset(),
            mode=None,
        ) -> SimpleNamespace:
            calls["count"] += 1
            return SimpleNamespace(
                answer=f"ok:{question}",
                sql_used="SELECT 1",
                sources_touched=["erp"],
                provenance={
                    "lineage": {
                        "connectors": ["erp"],
                        "tables": ["sales_order_header"],
                    },
                    "ontology_intent": {"intent_type": "count_orders"},
                },
                latency_ms=1,
                disambiguation_required=False,
                candidates=[],
                notes="cached-test",
            )

    fake_redis = FakeRedis()
    monkeypatch.setattr(app_module, "_semantic_cache_namespace", 0)
    monkeypatch.setattr(app_module, "_get_semantic_redis_client", lambda: fake_redis)
    monkeypatch.setitem(app_module._semantic_state, "loaded", True)
    monkeypatch.setitem(app_module._semantic_state, "layer", DummyLayer())

    payload = {
        "question": "Quanti ordini abbiamo nel 2014?",
        "context": {"tenant": "qa"},
    }
    first = client.post("/api/semantic/ask", json=payload, headers=auth_headers)
    second = client.post("/api/semantic/ask", json=payload, headers=auth_headers)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert calls["count"] == 1


class _FakeRedisWithIncr:
    """Minimal Redis stand-in that also supports INCR (atomic generation bump)."""

    def __init__(self) -> None:
        self.storage: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self.storage.get(key)

    def setex(self, key: str, _ttl: int, value: str) -> None:
        self.storage[key] = value

    def incr(self, key: str) -> int:
        new_value = int(self.storage.get(key, "0")) + 1
        self.storage[key] = str(new_value)
        return new_value


class TestSemanticCacheNamespaceIsSharedAcrossWorkers:
    """With SEMANTIC_REDIS_URL configured, the cache is shared across worker
    processes, but a plain module-level int is NOT — each worker has its own
    copy. If invalidation only bumped that local copy, the worker that
    *handled* a write-back/sync would stop hitting pre-mutation entries, while
    every *other* worker kept computing v{old_ns}:... keys and went on
    serving (and re-writing!) stale answers from the shared cache for up to
    SEMANTIC_REDIS_TTL_SECONDS. The generation must therefore be read back
    from Redis — the same store the bump increments — so all workers agree."""

    def test_bump_increments_the_shared_redis_generation(
        self, app_module, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake_redis = _FakeRedisWithIncr()
        monkeypatch.setattr(
            app_module, "_get_semantic_redis_client", lambda: fake_redis
        )
        monkeypatch.setattr(app_module, "_semantic_cache_namespace", 0)

        app_module._bump_semantic_cache_namespace()

        assert fake_redis.storage[app_module._SEMANTIC_CACHE_NS_REDIS_KEY] == "1"

    def test_cache_key_reflects_shared_generation_even_with_stale_local_counter(
        self, app_module, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake_redis = _FakeRedisWithIncr()
        monkeypatch.setattr(
            app_module, "_get_semantic_redis_client", lambda: fake_redis
        )

        # Worker A: handles the write-back and bumps the (shared) generation.
        monkeypatch.setattr(app_module, "_semantic_cache_namespace", 0)
        app_module._bump_semantic_cache_namespace()

        # Worker B: never received the write-back, so ITS process-local
        # counter is still stuck at 0 — exactly what would happen behind a
        # real load balancer / multi-worker server.
        monkeypatch.setattr(app_module, "_semantic_cache_namespace", 0)
        key = app_module._semantic_cache_key("same question?", {}, fake_redis)

        assert key.startswith("semantic:ask:v1:"), (
            "worker B must key its lookup off the *shared* generation (v1, "
            "bumped by worker A's write-back), not its own stale local "
            "counter (v0) — a v0 key would hit pre-mutation entries still "
            "sitting in the shared cache and serve stale answers"
        )

    def test_different_workers_compute_identical_keys_after_a_bump(
        self, app_module, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The whole point of a shared cache is that every worker computes the
        same key for the same question — otherwise hits never happen across
        worker boundaries. Local counters diverge; the Redis-backed
        generation must be what keeps them in lockstep."""
        fake_redis = _FakeRedisWithIncr()
        monkeypatch.setattr(
            app_module, "_get_semantic_redis_client", lambda: fake_redis
        )

        monkeypatch.setattr(app_module, "_semantic_cache_namespace", 0)
        app_module._bump_semantic_cache_namespace()  # worker A bumps to v1

        monkeypatch.setattr(
            app_module, "_semantic_cache_namespace", 0
        )  # worker B, stuck at v0
        key_worker_b = app_module._semantic_cache_key("q", {"s": 1}, fake_redis)

        monkeypatch.setattr(
            app_module, "_semantic_cache_namespace", 7
        )  # worker C, drifted to v7
        key_worker_c = app_module._semantic_cache_key("q", {"s": 1}, fake_redis)

        assert (
            key_worker_b
            == key_worker_c
            == "semantic:ask:v1:" + key_worker_b.split(":")[-1]
        )

    def test_falls_back_to_local_counter_when_redis_unavailable(
        self, app_module, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """No Redis configured → the in-process cache is used too, so the
        process-local counter is the *correct* source of truth (both are
        scoped to the same process and stay consistent with each other)."""
        monkeypatch.setattr(app_module, "_semantic_cache_namespace", 3)

        key = app_module._semantic_cache_key("q", {}, None)

        assert key.startswith("semantic:ask:v3:")
