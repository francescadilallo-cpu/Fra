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
	digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
	return f"pbkdf2_sha256${iterations}${salt}${base64.b64encode(digest).decode('ascii')}"


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
	from app.semantic.layer import Intent, NeuroSymbolicPlan, OntologyIntentMapping, SemanticLayer

	if not hasattr(SemanticLayer, "_get_or_build_cached_plan"):
		pytest.skip("Semantic plan cache not available in current SemanticLayer implementation")

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

	_ = layer._get_or_build_cached_plan(intent, mapping, context={"tenant": "perf-demo"})
	_ = layer._get_or_build_cached_plan(intent, mapping, context={"tenant": "perf-demo"})

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
	monkeypatch.setattr(app_module, "update_mapping", lambda table, field, ontology_path: True)

	response = client.put(
		"/api/ontology/mappings",
		json={"table": "sales_order_header", "field": "order_date", "ontology_path": "SalesOrder.order_date"},
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

	monkeypatch.setattr(app_module, "_ensure_semantic_loaded", _fake_ensure_semantic_loaded)

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
		def ask(self, question: str, context: dict[str, str]) -> SimpleNamespace:
			calls["count"] += 1
			return SimpleNamespace(
				answer=f"ok:{question}",
				sql_used="SELECT 1",
				sources_touched=["erp"],
				provenance={
					"lineage": {"connectors": ["erp"], "tables": ["sales_order_header"]},
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

	payload = {"question": "Quanti ordini abbiamo nel 2014?", "context": {"tenant": "qa"}}
	first = client.post("/api/semantic/ask", json=payload, headers=auth_headers)
	second = client.post("/api/semantic/ask", json=payload, headers=auth_headers)

	assert first.status_code == 200, first.text
	assert second.status_code == 200, second.text
	assert calls["count"] == 1
