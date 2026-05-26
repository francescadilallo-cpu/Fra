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
    assert len(lineage.get("tables", [])) > 0

    validation = result.provenance["validation"]
    assert validation.get("status") == "validated"


def test_invalid_model_mapping_raises_semantic_violation(layer, monkeypatch):
    from app.semantic.layer import OntologyIntentMapping, SemanticOntologyViolationError

    monkeypatch.setenv("SEMANTIC_REQUIRE_LLM_INTENT", "0")

    def _fake_mapping(question, baseline_intent):
        return OntologyIntentMapping(
            intent_type="count_orders",
            metric=None,
            entities=["Customer"],
            properties=["Customer.accountId"],
            relations=[],
            filters={},
            limit=None,
            year=None,
            model="test-double",
            raw_payload={"forced": True},
        )

    monkeypatch.setattr(layer, "_llm_ontology_mapping", _fake_mapping)

    with pytest.raises(SemanticOntologyViolationError):
        layer.ask("Quanti ordini abbiamo?")


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
