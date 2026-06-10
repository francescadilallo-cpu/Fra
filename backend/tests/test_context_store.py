"""Unit tests for ContextStore — context/store.py.

Uses a temporary in-memory DB (tmpdir fixture) so no files are left behind.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.context.store import ContextStore


@pytest.fixture()
def store(tmp_path) -> ContextStore:
    return ContextStore(db_path=tmp_path / "test_context.db")


# ── Documents ─────────────────────────────────────────────────────────────────


class TestDocuments:
    def test_add_and_list_document(self, store):
        doc = store.add_document("report.txt", "Sales grew 10%.", "txt")
        assert doc.id > 0
        assert doc.filename == "report.txt"
        docs = store.list_documents()
        assert len(docs) == 1
        assert docs[0].content == "Sales grew 10%."

    def test_list_empty(self, store):
        assert store.list_documents() == []

    def test_delete_document(self, store):
        doc = store.add_document("a.md", "content", "md")
        assert store.delete_document(doc.id) is True
        assert store.list_documents() == []

    def test_delete_missing_returns_false(self, store):
        assert store.delete_document(9999) is False

    def test_multiple_documents_ordered_by_newest(self, store):
        store.add_document("first.txt", "old", "txt")
        store.add_document("second.txt", "new", "txt")
        docs = store.list_documents()
        assert len(docs) == 2
        assert docs[0].filename == "second.txt"

    def test_search_finds_keyword(self, store):
        store.add_document("report.md", "Revenue increased by 15% in Q3.", "md")
        results = store.search_documents(["Revenue"])
        assert len(results) == 1
        assert "Revenue" in results[0]

    def test_search_case_insensitive(self, store):
        store.add_document("note.txt", "Margine commerciale elevato.", "txt")
        results = store.search_documents(["margine"])
        assert len(results) == 1

    def test_search_no_match_returns_empty(self, store):
        store.add_document("note.txt", "Something else entirely.", "txt")
        assert store.search_documents(["revenue"]) == []

    def test_list_document_meta_omits_content(self, store):
        store.add_document("report.txt", "A" * 10_000, "txt")
        metas = store.list_document_meta()
        assert len(metas) == 1
        assert metas[0].filename == "report.txt"
        assert metas[0].content == ""

    def test_list_document_meta_does_not_affect_list_documents(self, store):
        store.add_document("report.txt", "hello world", "txt")
        assert store.list_documents()[0].content == "hello world"


# ── Entities ──────────────────────────────────────────────────────────────────


class TestEntities:
    def test_add_entity(self, store):
        entity = store.add_entity(
            "Customer", "Cliente", ["client", "account"], "A CRM customer", "crm"
        )
        assert entity.id > 0
        assert entity.name == "Customer"
        assert entity.synonyms == ["client", "account"]

    def test_list_entities(self, store):
        store.add_entity("Customer", "Cliente", [], "", "crm")
        store.add_entity("Product", "Prodotto", [], "", "pim")
        entities = store.list_entities()
        assert len(entities) == 2
        names = {e.name for e in entities}
        assert names == {"Customer", "Product"}

    def test_delete_entity(self, store):
        e = store.add_entity("Temp", "Temp", [], "", "")
        assert store.delete_entity(e.id) is True
        assert store.list_entities() == []

    def test_delete_entity_missing_returns_false(self, store):
        assert store.delete_entity(9999) is False

    def test_synonyms_serialized_correctly(self, store):
        synonyms = ["buyer", "client", "account holder"]
        store.add_entity("C", "C", synonyms, "", "")
        loaded = store.list_entities()
        assert loaded[0].synonyms == synonyms


# ── Metrics ───────────────────────────────────────────────────────────────────


class TestMetrics:
    def test_add_metric(self, store):
        m = store.add_metric(
            "revenue",
            "Fatturato",
            ["ricavi", "vendite"],
            "Net sales",
            "USD",
            certified=True,
        )
        assert m.id > 0
        assert m.name == "revenue"
        assert m.certified is True
        assert m.unit == "USD"

    def test_list_metrics(self, store):
        store.add_metric("rev", "Rev", [], "", "USD", False)
        store.add_metric("margin", "Margine", [], "", "%", True)
        metrics = store.list_metrics()
        assert len(metrics) == 2

    def test_delete_metric(self, store):
        m = store.add_metric("temp", "Temp", [], "", "", False)
        assert store.delete_metric(m.id) is True
        assert store.list_metrics() == []

    def test_certified_flag_persisted(self, store):
        store.add_metric("m1", "M1", [], "", "", certified=True)
        store.add_metric("m2", "M2", [], "", "", certified=False)
        metrics = {m.name: m for m in store.list_metrics()}
        assert metrics["m1"].certified is True
        assert metrics["m2"].certified is False


# ── Glossary ──────────────────────────────────────────────────────────────────


class TestGlossary:
    def test_add_glossary_term(self, store):
        g = store.add_glossary_term("Fatturato", "Net annual sales revenue")
        assert g.id > 0
        assert g.term == "fatturato"  # lowercased
        assert g.definition == "Net annual sales revenue"

    def test_add_upserts_on_duplicate(self, store):
        store.add_glossary_term("Revenue", "Old definition")
        store.add_glossary_term("Revenue", "New definition")
        terms = store.list_glossary()
        assert len(terms) == 1
        assert terms[0].definition == "New definition"

    def test_list_glossary_ordered_alphabetically(self, store):
        store.add_glossary_term("Zebra", "Z term")
        store.add_glossary_term("Apple", "A term")
        terms = store.list_glossary()
        assert terms[0].term == "apple"
        assert terms[1].term == "zebra"

    def test_delete_glossary_term(self, store):
        g = store.add_glossary_term("temp", "definition")
        assert store.delete_glossary_term(g.id) is True
        assert store.list_glossary() == []

    def test_delete_glossary_missing_returns_false(self, store):
        assert store.delete_glossary_term(9999) is False

    def test_term_normalized_to_lowercase(self, store):
        store.add_glossary_term("  MARGINE  ", "Net margin")
        terms = store.list_glossary()
        assert terms[0].term == "margine"


# ── Semantic docs cache ────────────────────────────────────────────────────────


class TestSemanticDocsCache:
    def test_repeated_calls_return_cached_object(self, store):
        store.add_entity("orders", "Orders", [], "Order header", "erp")
        first = store.to_semantic_docs_override()
        second = store.to_semantic_docs_override()
        assert first is second

    def test_entity_mutation_invalidates_cache(self, store):
        store.to_semantic_docs_override()
        e = store.add_entity("orders", "Orders", [], "Order header", "erp")
        docs = store.to_semantic_docs_override()
        assert [x.name for x in docs.entities] == ["orders"]
        store.delete_entity(e.id)
        docs = store.to_semantic_docs_override()
        assert docs.entities == []

    def test_metric_mutation_invalidates_cache(self, store):
        store.to_semantic_docs_override()
        m = store.add_metric("revenue", "Revenue", [], "Total sales", "EUR", True)
        docs = store.to_semantic_docs_override()
        assert [x.name for x in docs.metrics] == ["revenue"]
        store.delete_metric(m.id)
        assert store.to_semantic_docs_override().metrics == []

    def test_glossary_mutation_invalidates_cache(self, store):
        store.to_semantic_docs_override()
        g = store.add_glossary_term("margine", "Net margin")
        docs = store.to_semantic_docs_override()
        assert [x.term for x in docs.glossary] == ["margine"]
        store.delete_glossary_term(g.id)
        assert store.to_semantic_docs_override().glossary == []
