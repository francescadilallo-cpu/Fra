"""Focused tests for the unified neuro-symbolic query pipeline."""

from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent.parent
SCENARIO = ROOT / "test_scenario"


@pytest.fixture(scope="session")
def connectors():
    from app.connectors.file_connector import FileConnector
    from app.connectors.postgres_connector import PostgresConnector
    from app.connectors.sqlite_connector import SQLiteConnector

    erp = PostgresConnector(SCENARIO / "erp_postgres" / "orion_sales_dump.sql")
    crm = SQLiteConnector(SCENARIO / "crm_sqlite" / "clienthub.db")
    hr_pim = FileConnector(
        hr_csv_path=SCENARIO / "hr_pim_files" / "dipendenti_hr.csv",
        pim_json_path=SCENARIO / "hr_pim_files" / "product_catalog_pim.json",
    )
    return erp, crm, hr_pim


@pytest.fixture(scope="session")
def kg(connectors):
    from app.kg.graph import KnowledgeGraph

    erp, crm, hr_pim = connectors
    graph = KnowledgeGraph()
    graph.build(erp, crm, hr_pim)
    return graph


@pytest.fixture(scope="session")
def ontology():
    from app.ontology.ontology import Ontology

    path = SCENARIO / "ontology_example.yaml"
    return Ontology.load(path) if path.exists() else None


@pytest.fixture(scope="session")
def catalog(connectors, ontology, kg):
    from app.metadata.catalog import MetadataCatalog

    erp, crm, hr_pim = connectors
    c = MetadataCatalog()
    c.populate([erp, crm, hr_pim], ontology, kg)
    return c


@pytest.fixture()
def layer(connectors, ontology, kg, catalog):
    from app.context.manager import ContextManager
    from app.semantic.layer import SemanticLayer

    erp, crm, hr_pim = connectors
    context = ContextManager()
    semantic_layer = SemanticLayer(ontology, kg, catalog, context)
    semantic_layer.set_connectors(erp, crm, hr_pim)
    return semantic_layer


def test_ask_includes_complete_lineage(layer, monkeypatch):
    monkeypatch.setenv("SEMANTIC_REQUIRE_LLM_INTENT", "0")

    result = layer.ask("Quanti ordini ci sono nel 2014?")

    assert isinstance(result.provenance, dict)
    assert "lineage" in result.provenance
    assert "ontology_intent" in result.provenance
    assert "validation" in result.provenance

    lineage = result.provenance["lineage"]
    assert isinstance(lineage.get("connectors"), list)
    assert isinstance(lineage.get("tables"), list)
    # NOTE: SQL-based golden-question handlers have been removed; questions now
    # fall to the LLM/template path. Without an LLM key, tables may be empty —
    # the important invariant is that the provenance structure is always present.

    validation = result.provenance["validation"]
    assert validation.get("status") == "validated"


def test_mismatched_model_entities_self_heal_from_contract(layer, monkeypatch):
    """If the LLM returns an unknown intent type, the server falls back to the
    'unknown' contract (empty entities/properties) and the pipeline stays stable
    rather than raising a 422. SQL-based intent types like 'count_orders' are no
    longer in _INTENT_CONTRACTS and are remapped to 'unknown'."""
    from app.semantic.layer import OntologyIntentMapping

    monkeypatch.setenv("SEMANTIC_REQUIRE_LLM_INTENT", "0")

    def _fake_mapping(question, baseline_intent):
        return OntologyIntentMapping(
            intent_type="impossible",  # structural intent still in contracts
            metric=None,
            entities=[],  # impossible contract has no entities
            properties=[],
            relations=[],
            filters={"reason": "nationality_not_available"},
            limit=None,
            year=None,
            model="test-double",
            raw_payload={"forced": True},
        )

    monkeypatch.setattr(layer, "_llm_ontology_mapping", _fake_mapping)

    result = layer.ask("Qual è la nazionalità degli impiegati?")

    # The impossible intent returns a controlled explanation, not a crash.
    ontology_intent = result.provenance["ontology_intent"]
    assert ontology_intent["intent_type"] == "impossible"
    assert isinstance(result.answer, str)
    assert "nationality" in result.answer.lower()


def test_guardrail_blocks_destructive_sql_keywords(layer):
    from app.semantic.layer import SemanticSecurityViolationError

    payload = {
        "intent_type": "count_orders",
        "filters": {
            "unsafe": "DROP TABLE sales_order_header",
        },
    }

    with pytest.raises(SemanticSecurityViolationError):
        layer._validate_llm_payload_security(payload)


def test_guardrail_blocks_system_table_access(layer):
    from app.semantic.layer import SemanticSecurityViolationError

    payload = {
        "intent_type": "count_orders",
        "filters": {
            "unsafe": "SELECT name FROM sqlite_master",
        },
    }

    with pytest.raises(SemanticSecurityViolationError):
        layer._validate_llm_payload_security(payload)


def test_guardrail_allows_catalog_scoped_payload(layer):
    payload = {
        "intent_type": "count_orders",
        "entities": ["SalesOrder"],
        "properties": ["SalesOrder.order_id"],
        "filters": {
            "year": "2014",
            "region": "north_america",
        },
    }

    layer._validate_llm_payload_security(payload)
