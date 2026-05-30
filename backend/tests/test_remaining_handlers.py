"""Unit tests for the remaining untested _q_* handler methods."""

from __future__ import annotations

import pytest
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
    return layer


def _intent(intent_type: str, **kwargs):
    from app.semantic.layer import Intent

    return Intent(intent_type=intent_type, **kwargs)


# ── _q_customers_by_state ─────────────────────────────────────────────────────


def test_customers_by_state_with_state():
    layer = _make_layer()
    layer._crm.execute_query.return_value = [
        {
            "accountId": 1,
            "ragioneSociale": "Acme",
            "nomeContatto": "J",
            "stateName": "California",
        }
    ]
    result = layer._q_customers_by_state(
        _intent("customers_by_state", filters={"state": "California"})
    )
    assert result.sources_touched == ["crm"]
    assert len(result.answer) == 1
    call_sql = layer._crm.execute_query.call_args[0][0]
    assert "stateName" in call_sql


def test_customers_by_state_falls_back_to_fuzzy_when_empty():
    layer = _make_layer()
    layer._crm.execute_query.side_effect = [
        [],
        [
            {
                "accountId": 2,
                "ragioneSociale": "B",
                "nomeContatto": "K",
                "stateName": "California",
            }
        ],
    ]
    result = layer._q_customers_by_state(
        _intent("customers_by_state", filters={"state": "Cali"})
    )
    assert layer._crm.execute_query.call_count == 2
    assert len(result.answer) == 1


def test_customers_by_state_no_state_returns_sample():
    layer = _make_layer()
    layer._crm.execute_query.return_value = []
    layer._q_customers_by_state(_intent("customers_by_state"))
    call_sql = layer._crm.execute_query.call_args[0][0]
    assert "LIMIT 20" in call_sql


# ── _q_top_salesperson_by_orders ─────────────────────────────────────────────


def test_top_salesperson_by_orders_with_year():
    layer = _make_layer()
    layer._erp.execute_query.return_value = [{"salesperson_ref": 7, "n": 412}]
    layer._hr_pim.execute_query.return_value = [
        {"Nome": "Maria", "Cognome": "Rossi", "Reparto": "Sales"}
    ]
    result = layer._q_top_salesperson_by_orders(
        _intent("top_salesperson_by_orders", year=2014)
    )
    assert result.answer["salesperson_ref"] == 7
    assert result.answer["order_count"] == 412
    assert result.answer["Nome"] == "Maria"
    erp_sql = layer._erp.execute_query.call_args[0][0]
    assert "strftime" in erp_sql


def test_top_salesperson_by_orders_empty_returns_none():
    layer = _make_layer()
    layer._erp.execute_query.return_value = []
    result = layer._q_top_salesperson_by_orders(_intent("top_salesperson_by_orders"))
    assert result.answer is None


def test_top_salesperson_by_orders_no_hr_enrichment():
    layer = _make_layer()
    layer._erp.execute_query.return_value = [{"salesperson_ref": 3, "n": 100}]
    layer._hr_pim.execute_query.return_value = []
    result = layer._q_top_salesperson_by_orders(_intent("top_salesperson_by_orders"))
    assert result.answer["Nome"] is None
    assert result.answer["Cognome"] is None


# ── _q_top_salespersons_by_revenue ────────────────────────────────────────────


def test_top_salespersons_by_revenue_with_year():
    layer = _make_layer()
    layer._erp.execute_query.return_value = [
        {"salesperson_ref": 1, "revenue": 1_000_000.0},
        {"salesperson_ref": 2, "revenue": 800_000.0},
    ]
    layer._hr_pim.execute_query.return_value = []
    result = layer._q_top_salespersons_by_revenue(
        _intent("top_salespersons_by_revenue", year=2014, limit=3)
    )
    assert result.sources_touched == ["erp", "hr_pim"]
    erp_sql = layer._erp.execute_query.call_args[0][0]
    assert "strftime" in erp_sql


def test_top_salespersons_by_revenue_limit_clamped():
    layer = _make_layer()
    layer._erp.execute_query.return_value = []
    layer._hr_pim.execute_query.return_value = []
    layer._q_top_salespersons_by_revenue(
        _intent("top_salespersons_by_revenue", limit=9999)
    )
    # The LIMIT ? parameter in the ERP query must be ≤ 50
    params = layer._erp.execute_query.call_args[0][1]
    assert params[-1] <= 50


# ── _q_revenue_by_territory ──────────────────────────────────────────────────


def test_revenue_by_territory_with_year():
    layer = _make_layer()
    layer._erp.execute_query.return_value = [
        {"territory_name": "Northwest", "revenue": 4_200_000.0}
    ]
    result = layer._q_revenue_by_territory(_intent("revenue_by_territory", year=2014))
    assert result.sources_touched == ["erp"]
    assert result.answer[0]["territory_name"] == "Northwest"
    call_sql = layer._erp.execute_query.call_args[0][0]
    assert "strftime" in call_sql


def test_revenue_by_territory_no_year():
    layer = _make_layer()
    layer._erp.execute_query.return_value = []
    result = layer._q_revenue_by_territory(_intent("revenue_by_territory"))
    call_sql = layer._erp.execute_query.call_args[0][0]
    assert "strftime" not in call_sql
    assert result.answer == []


# ── _q_revenue_vs_quota ──────────────────────────────────────────────────────


def test_revenue_vs_quota_with_year():
    layer = _make_layer()
    layer._erp.execute_query.return_value = [
        {
            "salesperson_ref": 5,
            "revenue": 900_000.0,
            "quota": 1_000_000.0,
            "pct_quota": 90.0,
        }
    ]
    result = layer._q_revenue_vs_quota(_intent("revenue_vs_quota", year=2014))
    assert result.sources_touched == ["erp"]
    assert result.answer[0]["pct_quota"] == 90.0
    call_sql = layer._erp.execute_query.call_args[0][0]
    assert "strftime" in call_sql


def test_revenue_vs_quota_no_year():
    layer = _make_layer()
    layer._erp.execute_query.return_value = []
    layer._q_revenue_vs_quota(_intent("revenue_vs_quota"))
    call_sql = layer._erp.execute_query.call_args[0][0]
    assert "strftime" not in call_sql


# ── _q_top_customer_by_spend ─────────────────────────────────────────────────


def test_top_customer_by_spend_with_crm_enrichment():
    layer = _make_layer()
    layer._erp.execute_query.return_value = [{"customer_ref": 42, "spesa": 250_000.0}]
    layer._crm.execute_query.return_value = [
        {"accountType": "B2B", "ragioneSociale": "MegaCorp", "nomeContatto": "A"}
    ]
    result = layer._q_top_customer_by_spend(_intent("top_customer_by_spend"))
    assert result.answer["customer_ref"] == 42
    assert result.answer["total_spend"] == 250_000.0
    assert result.answer["ragioneSociale"] == "MegaCorp"
    assert result.sources_touched == ["erp", "crm"]


def test_top_customer_by_spend_empty_erp_returns_none():
    layer = _make_layer()
    layer._erp.execute_query.return_value = []
    result = layer._q_top_customer_by_spend(_intent("top_customer_by_spend"))
    assert result.answer is None


# ── _q_customer_state_most_orders ────────────────────────────────────────────


def test_customer_state_most_orders():
    layer = _make_layer()
    layer._erp.execute_query.return_value = [{"customer_ref": 7, "n": 310}]
    layer._crm.execute_query.return_value = [{"stateName": "California"}]
    result = layer._q_customer_state_most_orders(_intent("customer_state_most_orders"))
    assert result.answer["state"] == "California"
    assert result.answer["order_count"] == 310
    assert result.sources_touched == ["erp", "crm"]


def test_customer_state_most_orders_no_state_fallback():
    layer = _make_layer()
    layer._erp.execute_query.return_value = [{"customer_ref": 7, "n": 310}]
    layer._crm.execute_query.return_value = []
    result = layer._q_customer_state_most_orders(_intent("customer_state_most_orders"))
    assert result.answer["state"] == "Unknown"


def test_customer_state_most_orders_no_orders_returns_none():
    layer = _make_layer()
    layer._erp.execute_query.return_value = []
    result = layer._q_customer_state_most_orders(_intent("customer_state_most_orders"))
    assert result.answer is None


# ── _q_avg_revenue_by_segment ────────────────────────────────────────────────


def test_avg_revenue_by_segment():
    layer = _make_layer()
    layer._erp.execute_query.return_value = [
        {"customer_ref": 1, "total": 10_000.0},
        {"customer_ref": 2, "total": 20_000.0},
        {"customer_ref": 3, "total": 5_000.0},
    ]
    layer._crm.execute_query.return_value = [
        {"accountId": 1, "accountType": "B2B"},
        {"accountId": 2, "accountType": "B2B"},
        {"accountId": 3, "accountType": "B2C"},
    ]
    result = layer._q_avg_revenue_by_segment(_intent("avg_revenue_by_segment"))
    assert result.sources_touched == ["erp", "crm"]
    by_type = {r["accountType"]: r for r in result.answer}
    assert by_type["B2B"]["n_customers"] == 2
    assert by_type["B2B"]["total_revenue"] == pytest.approx(30_000.0)
    assert by_type["B2B"]["avg_per_customer"] == pytest.approx(15_000.0)
    assert by_type["B2C"]["n_customers"] == 1


# ── _q_top_category_by_margin ────────────────────────────────────────────────


def test_top_category_by_margin():
    layer = _make_layer()
    layer._erp.execute_query.return_value = [
        {"product_ref": 10, "total_qty": 100},
        {"product_ref": 20, "total_qty": 50},
    ]
    layer._hr_pim.execute_query.return_value = [
        {
            "internal_id": 10,
            "categoryPath": "Bikes/Road",
            "listPrice": 800.0,
            "standardCost": 400.0,
        },
        {
            "internal_id": 20,
            "categoryPath": "Accessories",
            "listPrice": 50.0,
            "standardCost": 30.0,
        },
    ]
    result = layer._q_top_category_by_margin(_intent("top_category_by_margin"))
    assert result.sources_touched == ["erp", "hr_pim"]
    # Bikes: revenue=80000, cost=40000, margin=40000 → 50%
    # Accessories: revenue=2500, cost=1500, margin=1000 → 40%
    assert result.answer[0]["category"] == "Bikes"
    assert result.answer[0]["margin_pct"] == pytest.approx(50.0)


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


# ── _q_customers_without_orders ──────────────────────────────────────────────


def test_customers_without_orders_anti_join():
    layer = _make_layer()
    layer._crm.execute_query.return_value = [
        {
            "accountId": 1,
            "ragioneSociale": "A",
            "nomeContatto": "x",
            "accountType": "B2B",
        },
        {
            "accountId": 2,
            "ragioneSociale": "B",
            "nomeContatto": "y",
            "accountType": "B2C",
        },
        {
            "accountId": 3,
            "ragioneSociale": "C",
            "nomeContatto": "z",
            "accountType": "B2B",
        },
    ]
    layer._erp.execute_query.return_value = [
        {"customer_ref": 1},
        {"customer_ref": 3},
    ]
    result = layer._q_customers_without_orders(_intent("customers_without_orders"))
    assert result.answer["count"] == 1
    assert result.answer["customers"][0]["accountId"] == 2
    assert result.sources_touched == ["crm", "erp"]


def test_customers_without_orders_all_have_orders():
    layer = _make_layer()
    layer._crm.execute_query.return_value = [
        {
            "accountId": 5,
            "ragioneSociale": "X",
            "nomeContatto": "q",
            "accountType": "B2B",
        },
    ]
    layer._erp.execute_query.return_value = [{"customer_ref": 5}]
    result = layer._q_customers_without_orders(_intent("customers_without_orders"))
    assert result.answer["count"] == 0
    assert result.answer["customers"] == []


# ── _q_certified_metrics ─────────────────────────────────────────────────────


def test_certified_metrics_returns_hardcoded_list():
    layer = _make_layer()
    result = layer._q_certified_metrics(_intent("certified_metrics"))
    assert isinstance(result.answer, list)
    names = {m["name"] for m in result.answer}
    assert "revenue" in names
    assert "margin" in names
    assert all(m["status"] == "certified" for m in result.answer)
