"""Unit tests for semantic/doc_loader.py and semantic/doc_schema.py.

Uses synthetic YAML files written to tmp_path — no real data files required.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.semantic.doc_loader import DocLoader
from app.semantic.doc_schema import (
    EntityDoc,
    GlossaryTerm,
    SemanticDocs,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture()
def docs_dir(tmp_path) -> Path:
    return tmp_path


def write(dir: Path, name: str, content: str) -> None:
    (dir / name).write_text(content, encoding="utf-8")


# ── DocLoader._read ────────────────────────────────────────────────────────────


class TestRead:
    def test_missing_file_returns_none(self, docs_dir):
        loader = DocLoader(docs_dir)
        assert loader._read("nonexistent.yaml") is None

    def test_invalid_yaml_returns_none(self, docs_dir):
        write(docs_dir, "bad.yaml", "{ invalid: yaml: content: }")
        loader = DocLoader(docs_dir)
        assert loader._read("bad.yaml") is None

    def test_non_dict_returns_none(self, docs_dir):
        write(docs_dir, "list.yaml", "- item1\n- item2\n")
        loader = DocLoader(docs_dir)
        assert loader._read("list.yaml") is None

    def test_valid_dict_returned(self, docs_dir):
        write(docs_dir, "data.yaml", "key: value\n")
        loader = DocLoader(docs_dir)
        result = loader._read("data.yaml")
        assert result == {"key": "value"}


# ── DocLoader.load_entities ────────────────────────────────────────────────────


ENTITIES_YAML = """\
entities:
  - name: SalesOrder
    display_name: Sales Order
    synonyms: [order, ordine]
    description: A confirmed customer order
    source: erp
    primary_key: order_id
  - name: Customer
    display_name: Customer
    synonyms: [cliente]
    description: A buying party
    source: crm
"""


class TestLoadEntities:
    def test_missing_file_returns_empty_list(self, docs_dir):
        loader = DocLoader(docs_dir)
        assert loader.load_entities() == []

    def test_loads_entities(self, docs_dir):
        write(docs_dir, "entities.yaml", ENTITIES_YAML)
        entities = DocLoader(docs_dir).load_entities()
        assert len(entities) == 2

    def test_entity_fields(self, docs_dir):
        write(docs_dir, "entities.yaml", ENTITIES_YAML)
        e = DocLoader(docs_dir).load_entities()[0]
        assert e.name == "SalesOrder"
        assert e.display_name == "Sales Order"
        assert e.synonyms == ["order", "ordine"]
        assert e.source == "erp"
        assert e.primary_key == "order_id"

    def test_entity_defaults(self, docs_dir):
        write(
            docs_dir, "entities.yaml", "entities:\n  - name: X\n    display_name: X\n"
        )
        e = DocLoader(docs_dir).load_entities()[0]
        assert e.synonyms == []
        assert e.description == ""
        assert e.filter_active is None
        assert e.freshness is None


# ── DocLoader.load_metrics ────────────────────────────────────────────────────


METRICS_YAML = """\
metrics:
  - name: revenue
    display_name: Revenue
    synonyms: [fatturato, ricavi]
    description: Net revenue
    unit: USD
    certified: true
  - name: order_count
    display_name: Order Count
    certified: false
"""


class TestLoadMetrics:
    def test_missing_file_returns_empty_list(self, docs_dir):
        assert DocLoader(docs_dir).load_metrics() == []

    def test_loads_metrics(self, docs_dir):
        write(docs_dir, "metrics.yaml", METRICS_YAML)
        metrics = DocLoader(docs_dir).load_metrics()
        assert len(metrics) == 2

    def test_metric_fields(self, docs_dir):
        write(docs_dir, "metrics.yaml", METRICS_YAML)
        m = DocLoader(docs_dir).load_metrics()[0]
        assert m.name == "revenue"
        assert m.unit == "USD"
        assert m.certified is True
        assert m.synonyms == ["fatturato", "ricavi"]

    def test_metric_defaults(self, docs_dir):
        write(docs_dir, "metrics.yaml", "metrics:\n  - name: m\n    display_name: M\n")
        m = DocLoader(docs_dir).load_metrics()[0]
        assert m.certified is False
        assert m.unit is None
        assert m.sql_template is None


# ── DocLoader.load_glossary ────────────────────────────────────────────────────


GLOSSARY_YAML = """\
terms:
  - term: fatturato
    definition: Net annual sales revenue
  - term: margine
    definition: Gross margin percentage
"""


class TestLoadGlossary:
    def test_missing_file_returns_empty_list(self, docs_dir):
        assert DocLoader(docs_dir).load_glossary() == []

    def test_loads_glossary(self, docs_dir):
        write(docs_dir, "glossary.yaml", GLOSSARY_YAML)
        terms = DocLoader(docs_dir).load_glossary()
        assert len(terms) == 2

    def test_glossary_fields(self, docs_dir):
        write(docs_dir, "glossary.yaml", GLOSSARY_YAML)
        t = DocLoader(docs_dir).load_glossary()[0]
        assert t.term == "fatturato"
        assert t.definition == "Net annual sales revenue"


# ── DocLoader.load_rules ──────────────────────────────────────────────────────


RULES_YAML = """\
disambiguation_rules:
  - id: rule_1
    name: Revenue vs Margin
    description: Distinguish between revenue and margin contexts
"""


class TestLoadRules:
    def test_missing_file_returns_empty_list(self, docs_dir):
        assert DocLoader(docs_dir).load_rules() == []

    def test_loads_rules(self, docs_dir):
        write(docs_dir, "rules.yaml", RULES_YAML)
        rules = DocLoader(docs_dir).load_rules()
        assert len(rules) == 1
        assert rules[0].id == "rule_1"

    def test_rule_fields(self, docs_dir):
        write(docs_dir, "rules.yaml", RULES_YAML)
        r = DocLoader(docs_dir).load_rules()[0]
        assert r.name == "Revenue vs Margin"
        assert "Distinguish" in r.description


# ── DocLoader.load (composite) ────────────────────────────────────────────────


class TestLoad:
    def test_load_with_no_files_returns_empty_docs(self, docs_dir):
        docs = DocLoader(docs_dir).load()
        assert isinstance(docs, SemanticDocs)
        assert docs.entities == []
        assert docs.metrics == []
        assert docs.glossary == []
        assert docs.disambiguation_rules == []

    def test_load_with_all_files(self, docs_dir):
        write(docs_dir, "entities.yaml", ENTITIES_YAML)
        write(docs_dir, "metrics.yaml", METRICS_YAML)
        write(docs_dir, "glossary.yaml", GLOSSARY_YAML)
        write(docs_dir, "rules.yaml", RULES_YAML)
        docs = DocLoader(docs_dir).load()
        assert len(docs.entities) == 2
        assert len(docs.metrics) == 2
        assert len(docs.glossary) == 2
        assert len(docs.disambiguation_rules) == 1


# ── doc_schema models ──────────────────────────────────────────────────────────


class TestDocSchemaModels:
    def test_freshness_literal_valid(self):
        e = EntityDoc(name="X", display_name="X", freshness="realtime")
        assert e.freshness == "realtime"

    def test_freshness_literal_delayed(self):
        e = EntityDoc(name="X", display_name="X", freshness="delayed")
        assert e.freshness == "delayed"

    def test_glossary_term_required_fields(self):
        g = GlossaryTerm(term="t", definition="d")
        assert g.term == "t"
        assert g.definition == "d"

    def test_semantic_docs_is_pydantic_model(self):
        docs = SemanticDocs()
        assert isinstance(docs, SemanticDocs)
        assert docs.entities == []
