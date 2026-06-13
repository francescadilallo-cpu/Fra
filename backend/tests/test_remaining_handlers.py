"""Unit tests for the remaining structural _q_* handler methods.

SQL-based golden-question handlers have been removed. This file now covers
the structural handlers: _q_glossary_lookup, _q_disambiguation_rules,
and _q_certified_metrics.
"""

from __future__ import annotations

from unittest.mock import MagicMock


def _make_layer():
    from app.semantic.layer import SemanticLayer

    layer = SemanticLayer.__new__(SemanticLayer)
    layer._docs = None
    layer._parser = MagicMock()
    layer._ontology = MagicMock()
    layer._kg = MagicMock()
    layer._catalog = MagicMock()
    layer._catalog.list_entities.return_value = []
    layer._catalog.get_entity.return_value = None
    layer._ctx_mgr = None
    layer._erp = MagicMock()
    layer._crm = MagicMock()
    layer._hr_pim = MagicMock()
    # Unified mgr mock — all _exec() calls route here
    layer._mgr = MagicMock()
    layer._known_tables = frozenset()
    return layer


def _intent(intent_type: str, **kwargs):
    from app.semantic.layer import Intent

    return Intent(intent_type=intent_type, **kwargs)


# ── _q_glossary_lookup ────────────────────────────────────────────────────────


def test_glossary_lookup_known_term():
    layer = _make_layer()
    result = layer._q_glossary_lookup(
        _intent("glossary_lookup", filters={"term": "revenue"})
    )
    assert "SUM" in result.answer
    assert result.sources_touched == []


def test_glossary_lookup_fuzzy_match():
    layer = _make_layer()
    result = layer._q_glossary_lookup(
        _intent("glossary_lookup", filters={"term": "rev"})
    )
    # "rev" is substring of "revenue" key → fuzzy match
    assert result.answer is not None
    assert "not present" not in result.answer


def test_glossary_lookup_unknown_term_returns_available_list():
    layer = _make_layer()
    result = layer._q_glossary_lookup(
        _intent("glossary_lookup", filters={"term": "xyzzy"})
    )
    assert "not present" in result.answer
    assert "revenue" in result.answer  # available terms listed


def test_glossary_lookup_empty_term_does_not_fuzzy_match():
    # An empty term must NOT fuzzy-match the first glossary entry (an empty
    # string is a substring of everything); it should report "not present".
    layer = _make_layer()
    result = layer._q_glossary_lookup(_intent("glossary_lookup", filters={"term": ""}))
    assert "not present" in result.answer


def test_glossary_lookup_missing_term_filter_does_not_fuzzy_match():
    layer = _make_layer()
    result = layer._q_glossary_lookup(_intent("glossary_lookup", filters={}))
    assert "not present" in result.answer


# ── _q_disambiguation_rules ──────────────────────────────────────────────────


def test_disambiguation_rules_returns_three_hardcoded():
    layer = _make_layer()
    result = layer._q_disambiguation_rules(_intent("disambiguation_rules"))
    assert isinstance(result.answer, list)
    assert len(result.answer) == 3
    rule_ids = {r["rule_id"] for r in result.answer}
    assert "R1" in rule_ids
    assert "R2" in rule_ids
    assert "R3" in rule_ids


# ── _q_certified_metrics ─────────────────────────────────────────────────────


def test_certified_metrics_returns_hardcoded_list():
    # When the catalog returns no metrics, the handler falls back to _CERTIFIED_METRICS
    layer = _make_layer()
    layer._catalog.list_metric_objects.return_value = []
    result = layer._q_certified_metrics(_intent("certified_metrics"))
    assert isinstance(result.answer, list)
    names = {m["name"] for m in result.answer}
    assert "revenue" in names
    assert "margin" in names
    assert all(m["status"] == "certified" for m in result.answer)
