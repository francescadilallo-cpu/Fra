"""Unit tests for the remaining structural _q_* handler methods.

SQL-based golden-question handlers have been removed. This file now covers
the structural handlers: _q_glossary_lookup, _q_disambiguation_rules,
_q_certified_metrics, and _execute_template_query.
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


# ── _execute_template_query ───────────────────────────────────────────────────


def _tpl(sql: str, intent_type: str = "tpl_1", id: int = 1) -> dict:
    return {
        "id": id,
        "name": "test_template",
        "intent_type": intent_type,
        "sql_query": sql,
        "keywords": ["test"],
        "is_active": True,
        "sources": [],
    }


def test_template_year_from_intent_year_when_not_in_filters():
    # Regression: when year is in intent.year but NOT in intent.filters,
    # the template handler must still substitute {year} correctly.
    layer = _make_layer()
    layer._templates = [_tpl("SELECT * FROM t WHERE yr = {year}")]
    layer._mgr.execute.return_value = [{"x": 1}]
    intent = _intent("tpl_1", filters={}, year=2023)
    result = layer._execute_template_query(intent)
    assert result.sql_used is not None
    assert "2023" in result.sql_used


def test_template_limit_from_intent_limit_when_not_in_filters():
    # Regression: when limit is in intent.limit but NOT in intent.filters,
    # the template handler must still substitute {limit} correctly.
    layer = _make_layer()
    layer._templates = [_tpl("SELECT * FROM t LIMIT {limit}")]
    layer._mgr.execute.return_value = [{"x": 1}]
    intent = _intent("tpl_1", filters={}, limit=7)
    result = layer._execute_template_query(intent)
    assert result.sql_used is not None
    assert "7" in result.sql_used


def test_template_year_from_filters_takes_precedence_over_intent_year():
    # When both filters["year"] and intent.year are set, filters["year"] wins.
    layer = _make_layer()
    layer._templates = [_tpl("SELECT * FROM t WHERE yr = {year}")]
    layer._mgr.execute.return_value = []
    intent = _intent("tpl_1", filters={"year": 2022}, year=2019)
    result = layer._execute_template_query(intent)
    assert result.sql_used is not None
    assert "2022" in result.sql_used
    assert "2019" not in result.sql_used
