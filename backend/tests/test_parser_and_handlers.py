"""Tests for _RuleParser, _normalize_english_terms, and remaining _q_* handlers.

Covers the full intent-routing path plus handlers not yet unit-tested.
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


# ── _RuleParser: intent routing ───────────────────────────────────────────────


def test_parser_count_orders_italian():
    intent = _parser().parse("Quanti ordini abbiamo nel 2014?")
    assert intent.intent_type == "count_orders"
    assert intent.filters.get("year") == 2014 or intent.year == 2014


def test_parser_count_orders_english():
    intent = _parser().parse("How many orders do we have in 2014?")
    assert intent.intent_type == "count_orders"


def test_parser_count_employees_with_dept():
    intent = _parser().parse("Quanti dipendenti ci sono nel reparto Sales?")
    assert intent.intent_type == "count_employees"
    assert intent.filters.get("department") is not None


def test_parser_top_salespersons_by_revenue():
    intent = _parser().parse("Top 3 venditori per fatturato nel 2014")
    assert intent.intent_type == "top_salespersons_by_revenue"
    assert intent.limit == 3
    assert intent.year == 2014 or intent.filters.get("year") == 2014


def test_parser_product_price_with_code():
    intent = _parser().parse("Qual è il prezzo del prodotto Road-650?")
    assert intent.intent_type == "product_price"
    assert intent.filters.get("product_name") is not None


def test_parser_make_only():
    intent = _parser().parse("Quanti prodotti make only abbiamo?")
    assert intent.intent_type == "count_make_only"


def test_parser_margin_per_salesperson():
    intent = _parser().parse("Mostra il margine per venditore nel 2014")
    assert intent.intent_type == "margin_per_salesperson"
    assert intent.year == 2014 or intent.filters.get("year") == 2014


def test_parser_revenue_with_tax():
    intent = _parser().parse("Qual è il revenue with tax totale nel 2014?")
    assert intent.intent_type == "revenue_with_tax"


def test_parser_impossible_nationality():
    intent = _parser().parse("Qual è la nazionalità degli impiegati?")
    assert intent.intent_type == "impossible"
    assert intent.filters.get("reason") == "nationality_not_available"


def test_parser_entity_not_modeled_supplier():
    intent = _parser().parse("Mostrami i fornitori")
    assert intent.intent_type == "entity_not_modeled"
    assert intent.filters.get("entity") == "Supplier"


def test_parser_fatturato_standalone_raises_ambiguity():
    from app.semantic.layer import AmbiguityError

    with pytest.raises(AmbiguityError):
        _parser().parse("Qual è il fatturato nel 2014?")


def test_parser_fatturato_with_qualifier_does_not_raise():
    intent = _parser().parse("Qual è il fatturato per territorio nel 2014?")
    assert intent.intent_type == "revenue_by_territory"


def test_parser_customer_state_most_orders():
    intent = _parser().parse("Qual è lo stato con più ordini clienti?")
    assert intent.intent_type == "customer_state_most_orders"


def test_parser_unknown_falls_through():
    intent = _parser().parse("Parlami del meteo di domani")
    assert intent.intent_type == "unknown"


def test_parser_top_limit_extraction():
    intent = _parser().parse("Top 10 prodotti per quantità venduta")
    assert intent.intent_type == "top_products_by_qty"
    assert intent.limit == 10


def test_parser_orders_with_discount():
    intent = _parser().parse("Quanti ordini hanno avuto uno sconto applicato?")
    assert intent.intent_type == "orders_with_discount"


def test_parser_customers_without_orders():
    intent = _parser().parse("Quali clienti non hanno mai fatto un ordine nel CRM?")
    assert intent.intent_type == "customers_without_orders"


def test_parser_customers_unique():
    intent = _parser().parse("Quanti clienti unici abbiamo?")
    assert intent.intent_type == "count_customers_unique"


def test_parser_year_extracted_correctly():
    intent = _parser().parse("Quanti ordini nel 2023?")
    assert (intent.year == 2023) or (intent.filters.get("year") == 2023)


# ── _q_count_employees ────────────────────────────────────────────────────────


def test_count_employees_all():
    layer = _make_layer()
    layer._hr_pim.execute_query.return_value = [{"cnt": 290}]
    result = layer._q_count_employees(_intent("count_employees"))
    assert result.answer == 290
    assert result.sources_touched == ["hr_pim"]


def test_count_employees_with_department():
    layer = _make_layer()
    layer._hr_pim.execute_query.return_value = [{"cnt": 47}]
    result = layer._q_count_employees(
        _intent("count_employees", filters={"department": "Sales"})
    )
    assert result.answer == 47
    call_sql = layer._hr_pim.execute_query.call_args[0][0]
    assert "Reparto" in call_sql


def test_count_employees_zero_on_empty():
    layer = _make_layer()
    layer._hr_pim.execute_query.return_value = []
    result = layer._q_count_employees(_intent("count_employees"))
    assert result.answer == 0


def test_count_employees_includes_hr_freshness_warning():
    layer = _make_layer()
    layer._hr_pim.execute_query.return_value = [{"cnt": 5}]
    result = layer._q_count_employees(_intent("count_employees"))
    assert "Delayed" in result.notes


# ── _q_avg_hourly_rate ────────────────────────────────────────────────────────


def test_avg_hourly_rate_all():
    layer = _make_layer()
    layer._hr_pim.execute_query.return_value = [{"avg_rate": 18.75}]
    result = layer._q_avg_hourly_rate(_intent("avg_hourly_rate"))
    assert result.answer == pytest.approx(18.75)
    assert result.sources_touched == ["hr_pim"]


def test_avg_hourly_rate_by_dept():
    layer = _make_layer()
    layer._hr_pim.execute_query.return_value = [{"avg_rate": 22.10}]
    result = layer._q_avg_hourly_rate(
        _intent("avg_hourly_rate", filters={"department": "Engineering"})
    )
    call_sql = layer._hr_pim.execute_query.call_args[0][0]
    assert "Reparto" in call_sql
    assert result.answer == pytest.approx(22.10)


def test_avg_hourly_rate_none_on_empty():
    layer = _make_layer()
    layer._hr_pim.execute_query.return_value = []
    result = layer._q_avg_hourly_rate(_intent("avg_hourly_rate"))
    assert result.answer is None


# ── _q_count_make_only ────────────────────────────────────────────────────────


def test_count_make_only():
    layer = _make_layer()
    layer._hr_pim.execute_query.return_value = [{"cnt": 115}]
    result = layer._q_count_make_only(_intent("count_make_only"))
    assert result.answer == 115
    assert result.sources_touched == ["hr_pim"]
    assert "isMakeOnly" in layer._hr_pim.execute_query.call_args[0][0]


# ── _q_product_price ─────────────────────────────────────────────────────────


def test_product_price_exact_match():
    layer = _make_layer()
    # First call: exact match returns a result
    layer._hr_pim.execute_query.return_value = [
        {
            "displayName": "Road-650 Black, 48",
            "listPrice": 782.99,
            "standardCost": 486.76,
        }
    ]
    result = layer._q_product_price(
        _intent("product_price", filters={"product_name": "Road-650"})
    )
    assert result.sources_touched == ["hr_pim"]
    assert len(result.answer) == 1


def test_product_price_falls_back_to_fuzzy():
    layer = _make_layer()
    # First exact call: no result; second fuzzy call: result
    layer._hr_pim.execute_query.side_effect = [
        [],
        [
            {
                "displayName": "Road-650 Black, 48",
                "listPrice": 782.99,
                "standardCost": 486.76,
            }
        ],
    ]
    result = layer._q_product_price(
        _intent("product_price", filters={"product_name": "Road-650"})
    )
    assert layer._hr_pim.execute_query.call_count == 2
    assert len(result.answer) == 1


def test_product_price_no_name_returns_top10():
    layer = _make_layer()
    layer._hr_pim.execute_query.return_value = [
        {"displayName": "X", "listPrice": 1.0, "standardCost": 0.5}
    ] * 10
    result = layer._q_product_price(_intent("product_price"))
    call_sql = layer._hr_pim.execute_query.call_args[0][0]
    assert "LIMIT 10" in call_sql
    assert len(result.answer) == 10


# ── _q_list_b2b_active ───────────────────────────────────────────────────────


def test_list_b2b_active_returns_count_and_companies():
    layer = _make_layer()
    layer._crm.execute_query.side_effect = [
        [{"cnt": 42}],
        [{"accountId": 1, "ragioneSociale": "Acme"}],
    ]
    result = layer._q_list_b2b_active(_intent("list_b2b_active"))
    assert result.answer["unique_b2b_active"] == 42
    assert len(result.answer["companies"]) == 1
    assert result.sources_touched == ["crm"]


# ── _q_count_employees_by_group ──────────────────────────────────────────────


def test_count_employees_by_group():
    layer = _make_layer()
    layer._hr_pim.execute_query.return_value = [
        {"GruppoReparto": "Production", "cnt": 120},
        {"GruppoReparto": "Sales", "cnt": 47},
    ]
    result = layer._q_count_employees_by_group(_intent("count_employees_by_group"))
    assert result.sources_touched == ["hr_pim"]
    assert len(result.answer) == 2
    assert result.answer[0]["GruppoReparto"] == "Production"


# ── _q_orders_with_discount ──────────────────────────────────────────────────


def test_orders_with_discount():
    layer = _make_layer()
    layer._erp.execute_query.return_value = [{"cnt": 5432}]
    result = layer._q_orders_with_discount(_intent("orders_with_discount"))
    assert result.answer == 5432
    assert result.sources_touched == ["erp"]
    assert "offer_ref" in layer._erp.execute_query.call_args[0][0]


# ── _q_employees_with_duplicate_customers ─────────────────────────────────────


def test_employees_with_duplicate_customers_always_zero():
    layer = _make_layer()
    result = layer._q_employees_with_duplicate_customers(
        _intent("employees_with_duplicate_customers")
    )
    assert result.answer["employee_count"] == 0
    assert result.sources_touched == []
    assert not result.disambiguation_required
