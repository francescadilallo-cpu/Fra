"""Unit tests for remaining SemanticLayer _q_* structural handler methods.

SQL-based handlers have been removed; only structural (non-SQL) handlers remain.
"""

from __future__ import annotations

from unittest.mock import MagicMock


# ── helpers ───────────────────────────────────────────────────────────────────


def _make_layer():
    """Build a SemanticLayer instance with all connectors mocked."""
    from app.semantic.layer import SemanticLayer

    layer = SemanticLayer.__new__(SemanticLayer)
    layer._docs = None
    layer._parser = MagicMock()
    layer._ontology = None  # None so entity_not_modeled falls to catalog/hardcoded
    layer._kg = MagicMock()
    layer._catalog = MagicMock()
    layer._catalog.list_entities.return_value = ["SalesOrder"]
    layer._catalog.get_entity.return_value = None
    layer._ctx_mgr = None
    layer._erp = MagicMock()
    layer._crm = MagicMock()
    layer._hr_pim = MagicMock()
    # Unified mgr mock — all _exec() calls route here when mgr is set
    layer._mgr = MagicMock()
    layer._known_tables = frozenset()
    return layer


def _intent(intent_type: str, **kwargs):
    from app.semantic.layer import Intent

    return Intent(intent_type=intent_type, **kwargs)


# ── _q_impossible ─────────────────────────────────────────────────────────────


def test_impossible_known_reason():
    layer = _make_layer()
    result = layer._q_impossible(
        _intent("impossible", filters={"reason": "nationality_not_available"})
    )
    assert result.answer is None
    assert "nationality" in result.notes.lower()
    assert result.sources_touched == []


def test_impossible_unknown_reason_fallback():
    layer = _make_layer()
    result = layer._q_impossible(_intent("impossible", filters={"reason": "xyzzy"}))
    assert "not available" in result.notes
    assert result.sources_touched == []


# ── _q_entity_not_modeled ────────────────────────────────────────────────────


def test_entity_not_modeled_no_docs():
    """Without docs or ontology, falls back to catalog or hardcoded entity list."""
    layer = _make_layer()
    # With _ontology=None and catalog returning only ["SalesOrder"], the catalog
    # branch is used. Verify the requested entity name appears and the catalog
    # entity list is present.
    result = layer._q_entity_not_modeled(
        _intent("entity_not_modeled", filters={"entity": "Supplier"})
    )
    assert result.answer is None
    assert "Supplier" in result.notes
    assert "SalesOrder" in result.notes  # catalog entity list present


def test_entity_not_modeled_with_docs_uses_doc_entities():
    """With docs, doc entity names appear in the notes."""
    from app.semantic.doc_schema import SemanticDocs

    layer = _make_layer()
    fake_entity = MagicMock()
    fake_entity.display_name = "Widget"

    fake_docs = MagicMock(spec=SemanticDocs)
    fake_docs.entities = [fake_entity]
    fake_docs.glossary = []
    fake_docs.metrics = []
    fake_docs.disambiguation_rules = []
    layer._docs = fake_docs

    result = layer._q_entity_not_modeled(
        _intent("entity_not_modeled", filters={"entity": "Sprocket"})
    )

    assert "Widget" in result.notes


# ── _q_data_provenance ───────────────────────────────────────────────────────


def test_data_provenance_delegates_to_catalog():
    layer = _make_layer()
    layer._catalog.list_entities.return_value = ["SalesOrder", "Customer"]
    meta = MagicMock()
    meta.to_dict.return_value = {"source": "erp"}
    layer._catalog.get_entity.return_value = meta

    result = layer._q_data_provenance(_intent("data_provenance"))

    assert "SalesOrder" in result.answer
    assert result.answer["SalesOrder"] == {"source": "erp"}
