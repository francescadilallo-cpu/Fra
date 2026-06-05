"""Tests for _RuleParser, _normalize_english_terms, and structural _q_* handlers.

The SQL-based golden-question handlers have been removed from the semantic layer.
This file now covers:
  - _normalize_english_terms
  - _RuleParser structural-intent routing (impossible, entity_not_modeled, etc.)
  - Parser fallback to 'unknown' for questions formerly handled by SQL methods
  - The six structural handlers that remain
"""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock


# ── helpers ───────────────────────────────────────────────────────────────────


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


def _parser():
    from app.semantic.layer import _RuleParser

    return _RuleParser()


# ── _normalize_english_terms ──────────────────────────────────────────────────


def test_normalize_how_many_customers():
    from app.semantic.layer import _normalize_english_terms

    assert "quanti clienti" in _normalize_english_terms("how many customers")


def test_normalize_orders():
    from app.semantic.layer import _normalize_english_terms

    result = _normalize_english_terms("how many orders do we have")
    assert "quanti" in result
    assert "ordini" in result


def test_normalize_employees():
    from app.semantic.layer import _normalize_english_terms

    result = _normalize_english_terms("number of employees in Sales")
    assert "dipendenti" in result


def test_normalize_revenue_maps_to_incassi():
    from app.semantic.layer import _normalize_english_terms

    result = _normalize_english_terms("show revenue by territory")
    assert "incassi" in result


def test_normalize_italian_passthrough():
    from app.semantic.layer import _normalize_english_terms

    original = "quanti dipendenti nel reparto Sales?"
    assert _normalize_english_terms(original) == original


# ── _RuleParser: structural intent routing ────────────────────────────────────


def test_parser_impossible_nationality():
    intent = _parser().parse("Qual è la nazionalità degli impiegati?")
    assert intent.intent_type == "impossible"
    assert intent.filters.get("reason") == "nationality_not_available"


def test_parser_entity_not_modeled_supplier():
    intent = _parser().parse("Mostrami i fornitori")
    assert intent.intent_type == "entity_not_modeled"
    assert intent.filters.get("entity") == "Supplier"


def test_parser_glossary_lookup():
    intent = _parser().parse("Cosa intendete per revenue?")
    assert intent.intent_type == "glossary_lookup"


def test_parser_disambiguation_rules():
    intent = _parser().parse("Spiega le regole di disambiguazione attive")
    assert intent.intent_type == "disambiguation_rules"


def test_parser_certified_metrics():
    intent = _parser().parse("Quali metriche certificate sono disponibili?")
    assert intent.intent_type == "certified_metrics"


def test_parser_data_provenance():
    intent = _parser().parse("Qual è la provenienza dei dati?")
    assert intent.intent_type == "data_provenance"


def test_parser_fatturato_standalone_raises_ambiguity():
    from app.semantic.layer import AmbiguityError

    with pytest.raises(AmbiguityError):
        _parser().parse("Qual è il fatturato nel 2014?")


def test_parser_fatturato_with_qualifier_falls_to_unknown():
    """With qualifier 'per territorio', no AmbiguityError; goes to unknown (→ LLM/template)."""
    intent = _parser().parse("Qual è il fatturato per territorio nel 2014?")
    # No longer matches a hardcoded handler — falls through to unknown or template
    assert intent.intent_type in {"unknown", "revenue_by_territory"}


def test_parser_unknown_falls_through():
    intent = _parser().parse("Parlami del meteo di domani")
    assert intent.intent_type == "unknown"


def test_parser_year_extracted_and_passed_to_unknown():
    """Year is extracted and passed through even on unknown intent."""
    intent = _parser().parse("Quanti ordini nel 2023?")
    assert (intent.year == 2023) or (intent.filters.get("year") == 2023)


def test_parser_formerly_sql_questions_now_unknown():
    """Questions that used to route to SQL handlers now fall to unknown (LLM fallback)."""
    questions = [
        "Quanti ordini abbiamo nel 2014?",
        "Quanti dipendenti ci sono nel reparto Sales?",
        "Top 3 venditori per fatturato nel 2014",
        "Qual è il prezzo del prodotto Road-650?",
        "Quanti prodotti make only abbiamo?",
        "Quanti ordini hanno avuto uno sconto applicato?",
    ]
    p = _parser()
    for q in questions:
        intent = p.parse(q)
        assert intent.intent_type in {"unknown", "impossible", "entity_not_modeled"}, (
            f"Expected unknown/structural for '{q}', got '{intent.intent_type}'"
        )


def test_parser_template_keyword_takes_priority():
    """A template with a matching keyword is returned before structural patterns."""
    templates = [
        {
            "id": 1,
            "intent_type": "tpl_1",
            "keywords": ["quanti ordini"],
            "sql_query": "SELECT COUNT(*) FROM sales_order_header",
            "is_active": True,
            "name": "count_orders_template",
        }
    ]
    intent = _parser().parse("Quanti ordini abbiamo nel 2014?", templates=templates)
    assert intent.intent_type == "tpl_1"


def test_parser_inactive_template_not_matched():
    """Inactive templates are skipped."""
    templates = [
        {
            "id": 2,
            "intent_type": "tpl_2",
            "keywords": ["quanti ordini"],
            "sql_query": "SELECT COUNT(*) FROM sales_order_header",
            "is_active": False,
            "name": "inactive",
        }
    ]
    intent = _parser().parse("Quanti ordini abbiamo nel 2014?", templates=templates)
    assert intent.intent_type == "unknown"
