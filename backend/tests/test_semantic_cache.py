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
            self, question: str, context: dict[str, str], docs_override=None
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
