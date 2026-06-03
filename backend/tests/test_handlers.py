"""Unit tests for SemanticLayer _q_* handler methods.

Each test builds a minimal layer (no real connectors) and verifies
the handler's return value and guard logic without touching a DB.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest


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


# ── _q_count_orders ───────────────────────────────────────────────────────────


def test_count_orders_without_year():
    layer = _make_layer()
    layer._mgr.execute.return_value = [{"cnt": 31465}]

    result = layer._q_count_orders(_intent("count_orders"))

    assert result.answer == 31465
    assert result.sources_touched == ["erp"]
    # No year filter → empty params tuple
    call_args = layer._mgr.execute.call_args
    assert call_args[0][0].strip().startswith("SELECT COUNT(*)")
    assert call_args[0][1] == ()  # no params


def test_count_orders_with_year_filter():
    layer = _make_layer()
    layer._mgr.execute.return_value = [{"cnt": 3987}]

    result = layer._q_count_orders(_intent("count_orders", filters={"year": 2014}))

    assert result.answer == 3987
    call_args = layer._mgr.execute.call_args
    sql, params = call_args[0]
    assert "strftime" in sql
    assert params == ("2014",)


def test_count_orders_returns_zero_on_empty_rows():
    layer = _make_layer()
    layer._mgr.execute.return_value = []

    result = layer._q_count_orders(_intent("count_orders"))

    assert result.answer == 0


# ── _q_top_products_by_qty ────────────────────────────────────────────────────


def test_top_products_limit_clamp():
    """User-supplied limit=9999 is clamped to ≤ 50."""
    layer = _make_layer()
    captured_params: list = []

    def capture(sql, params=()):
        captured_params.append(params)
        return []

    layer._mgr.execute = capture

    layer._q_top_products_by_qty(_intent("top_products_by_qty", limit=9999))

    # The clamped limit is passed as the last element of the params tuple
    assert captured_params, "No exec calls made"
    assert captured_params[0][-1] <= 50, f"Limit not clamped: {captured_params}"


def test_top_products_limit_minimum():
    """Limit is clamped to at least 1."""
    layer = _make_layer()
    captured_params: list = []

    def capture(sql, params=()):
        captured_params.append(params)
        return []

    layer._mgr.execute = capture

    layer._q_top_products_by_qty(_intent("top_products_by_qty", limit=0))

    assert captured_params, "No exec calls made"
    assert captured_params[0][-1] >= 1, f"Limit below 1: {captured_params}"


# ── _q_count_customers_unique ────────────────────────────────────────────────


def test_count_customers_unique_arithmetic():
    """unique = total - duplicates (accountId < 0)."""
    layer = _make_layer()
    layer._mgr.execute.side_effect = [
        [{"total": 20201}],
        [{"dups": 381}],
    ]

    result = layer._q_count_customers_unique(_intent("count_customers_unique"))

    assert result.answer == {"total": 20201, "duplicates": 381, "unique": 19820}
    assert result.sources_touched == ["crm"]


# ── _q_check_duplicate_accounts ──────────────────────────────────────────────


def test_check_duplicate_accounts_global():
    """Without company filter, returns aggregate duplicate count."""
    layer = _make_layer()
    layer._mgr.execute.return_value = [{"dups": 42}]

    result = layer._q_check_duplicate_accounts(_intent("check_duplicate_accounts"))

    assert result.answer == {"duplicate_count": 42}
    assert not result.disambiguation_required


def test_check_duplicate_accounts_with_company_triggers_disambiguation():
    """With company filter and negatives found, sets disambiguation_required=True."""
    layer = _make_layer()
    layer._mgr.execute.return_value = [
        {
            "accountId": 5,
            "accountType": "B2B",
            "ragioneSociale": "Acme",
            "nomeContatto": "x",
            "emailContatto": "e",
            "isActive": 1,
        },
        {
            "accountId": -5,
            "accountType": "B2B",
            "ragioneSociale": "Acme",
            "nomeContatto": "x",
            "emailContatto": "e",
            "isActive": 0,
        },
    ]

    result = layer._q_check_duplicate_accounts(
        _intent("check_duplicate_accounts", filters={"company": "Acme"})
    )

    assert result.disambiguation_required is True
    assert result.answer["has_duplicates"] is True
    assert len(result.answer["positive_accounts"]) == 1
    assert len(result.answer["duplicate_accounts"]) == 1


def test_check_duplicate_accounts_no_duplicates():
    """With company filter but no negative accountIds, disambiguation_required=False."""
    layer = _make_layer()
    layer._mgr.execute.return_value = [
        {
            "accountId": 5,
            "accountType": "B2B",
            "ragioneSociale": "Acme",
            "nomeContatto": "x",
            "emailContatto": "e",
            "isActive": 1,
        },
    ]

    result = layer._q_check_duplicate_accounts(
        _intent("check_duplicate_accounts", filters={"company": "Acme"})
    )

    assert result.disambiguation_required is False
    assert result.answer["has_duplicates"] is False


# ── _q_impossible ─────────────────────────────────────────────────────────────


def test_impossible_known_reason():
    layer = _make_layer()
    result = layer._q_impossible(
        _intent("impossible", filters={"reason": "nationality_not_available"})
    )
    # answer now carries the user-facing explanation (not None)
    assert isinstance(result.answer, str)
    assert "nationality" in result.answer.lower()
    assert result.sources_touched == []


def test_impossible_unknown_reason_fallback():
    layer = _make_layer()
    result = layer._q_impossible(_intent("impossible", filters={"reason": "xyzzy"}))
    assert isinstance(result.answer, str)
    assert (
        "not available" in result.answer.lower()
        or "cannot be answered" in result.answer.lower()
    )
    assert result.sources_touched == []


# ── _q_entity_not_modeled ────────────────────────────────────────────────────


def test_entity_not_modeled_no_docs():
    """Without docs or ontology, falls back to catalog or hardcoded entity list."""
    layer = _make_layer()
    # With _ontology=None and catalog returning only ["SalesOrder"], the catalog
    # branch is used. Verify the requested entity name appears in the answer.
    result = layer._q_entity_not_modeled(
        _intent("entity_not_modeled", filters={"entity": "Supplier"})
    )
    assert isinstance(result.answer, str)
    assert "Supplier" in result.answer
    assert "SalesOrder" in result.answer  # catalog entity list present


def test_entity_not_modeled_with_docs_uses_doc_entities():
    """With docs, doc entity names appear in the answer."""
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

    assert "Widget" in result.answer


# ── _q_revenue_with_tax ───────────────────────────────────────────────────────


def test_revenue_with_tax_with_year():
    layer = _make_layer()
    layer._mgr.execute.return_value = [{"revenue_with_tax": 22_436_011.08}]

    result = layer._q_revenue_with_tax(_intent("revenue_with_tax", year=2014))

    assert result.answer == pytest.approx(22_436_011.08)
    assert result.sources_touched == ["erp"]
    call_sql = layer._mgr.execute.call_args[0][0]
    assert "strftime" in call_sql


def test_revenue_with_tax_without_year():
    layer = _make_layer()
    layer._mgr.execute.return_value = [{"revenue_with_tax": 109_846_381.40}]

    result = layer._q_revenue_with_tax(_intent("revenue_with_tax"))

    assert result.answer == pytest.approx(109_846_381.40)
    call_sql = layer._mgr.execute.call_args[0][0]
    assert "strftime" not in call_sql


def test_revenue_with_tax_empty_rows_returns_none():
    layer = _make_layer()
    layer._mgr.execute.return_value = []

    result = layer._q_revenue_with_tax(_intent("revenue_with_tax"))

    assert result.answer is None


# ── _q_lookup_employee ───────────────────────────────────────────────────────


def test_lookup_employee_single_match():
    layer = _make_layer()
    layer._mgr.execute.return_value = [
        {"Nome": "John", "Cognome": "Doe", "MatricolaDip": 1, "Reparto": "Sales"}
    ]

    result = layer._q_lookup_employee(
        _intent("lookup_employee", filters={"name": "doe"})
    )

    assert not result.disambiguation_required
    assert len(result.answer) == 1


def test_lookup_employee_multiple_matches_triggers_disambiguation():
    layer = _make_layer()
    layer._mgr.execute.return_value = [
        {"Nome": "John", "Cognome": "Doe", "MatricolaDip": 1, "Reparto": "Sales"},
        {"Nome": "Jane", "Cognome": "Doe", "MatricolaDip": 2, "Reparto": "HR"},
    ]

    result = layer._q_lookup_employee(
        _intent("lookup_employee", filters={"name": "doe"})
    )

    assert result.disambiguation_required is True
    assert len(result.candidates) == 2


def test_lookup_employee_no_match_returns_empty():
    layer = _make_layer()
    layer._mgr.execute.return_value = []

    result = layer._q_lookup_employee(
        _intent("lookup_employee", filters={"name": "nobody"})
    )

    assert not result.disambiguation_required
    assert result.answer == []


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


# ── _q_margin_per_salesperson ─────────────────────────────────────────────────


def test_margin_per_salesperson_executes_one_erp_query_not_two():
    """Handler makes exactly 2 _exec calls: 1 PIM cost query + 1 ERP margin query."""
    layer = _make_layer()
    # Call order: PIM cost query first, then ERP margin query
    layer._mgr.execute.side_effect = [
        [{"internal_id": 42, "standardCost": 100.0, "listPrice": 150.0}],  # PIM
        [{"salesperson_ref": 7, "product_ref": 42, "total_qty": 10}],  # ERP
    ]

    result = layer._q_margin_per_salesperson(
        _intent("margin_per_salesperson", year=2014)
    )

    assert layer._mgr.execute.call_count == 2  # 1 PIM + 1 ERP
    assert result.sources_touched == ["erp", "hr_pim"]
    assert len(result.answer) == 1
    assert result.answer[0]["salesperson_ref"] == 7
    assert result.answer[0]["margin"] == pytest.approx(500.0)  # 10 * (150 - 100)


def test_margin_per_salesperson_no_year():
    """Without year filter, uses the unfiltered margin_sql."""
    layer = _make_layer()
    layer._mgr.execute.side_effect = [[], []]  # PIM, then ERP (both empty)

    result = layer._q_margin_per_salesperson(_intent("margin_per_salesperson"))

    assert layer._mgr.execute.call_count == 2
    # ERP margin SQL is the second call; verify no year filter
    erp_sql = layer._mgr.execute.call_args_list[1][0][0]
    assert "strftime" not in erp_sql
    assert result.answer == []
