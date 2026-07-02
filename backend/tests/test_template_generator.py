"""Unit tests for semantic/template_generator.py.

Covers the column-detection helpers and the main generate_templates_from_draft
function with synthetic draft dictionaries — no DB required.
"""

from __future__ import annotations

import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent))

from app.semantic.template_generator import (
    _find_date_col,
    _find_name_col,
    _find_segment_cols,
    _parse_formula,
    generate_templates_from_draft,
)


# ── _find_date_col ─────────────────────────────────────────────────────────────


class TestFindDateCol:
    def test_exact_match_date(self):
        assert _find_date_col(["id", "name", "date"]) == "date"

    def test_exact_match_order_date(self):
        assert _find_date_col(["order_date", "amount"]) == "order_date"

    def test_exact_match_created_at(self):
        assert _find_date_col(["created_at", "updated_at"]) == "created_at"

    def test_italian_date_column(self):
        assert _find_date_col(["id", "data_ordine"]) == "data_ordine"

    def test_substring_fallback(self):
        assert _find_date_col(["invoice_date_iso", "amount"]) == "invoice_date_iso"

    def test_timestamp_substring(self):
        assert _find_date_col(["created_timestamp", "id"]) == "created_timestamp"

    def test_no_date_col_returns_none(self):
        assert _find_date_col(["id", "name", "amount", "status"]) is None

    def test_empty_list_returns_none(self):
        assert _find_date_col([]) is None

    def test_prefers_exact_hint_over_substring(self):
        result = _find_date_col(["invoice_date_iso", "date"])
        assert result == "date"  # exact hint "date" first


# ── _find_segment_cols ─────────────────────────────────────────────────────────


class TestFindSegmentCols:
    def test_finds_category(self):
        cols = _find_segment_cols(["id", "category", "price"])
        assert "category" in cols

    def test_finds_sector(self):
        cols = _find_segment_cols(["id", "sector", "amount"])
        assert "sector" in cols

    def test_finds_type(self):
        cols = _find_segment_cols(["id", "type", "amount"])
        assert "type" in cols

    def test_italian_segment_col(self):
        cols = _find_segment_cols(["id", "categoria", "prezzo"])
        assert "categoria" in cols

    def test_returns_at_most_three(self):
        cols = _find_segment_cols(["category", "sector", "type", "group", "tier"])
        assert len(cols) <= 3

    def test_no_segment_col_returns_empty(self):
        cols = _find_segment_cols(["id", "name", "amount"])
        assert cols == []

    def test_empty_list_returns_empty(self):
        assert _find_segment_cols([]) == []

    def test_substring_match(self):
        cols = _find_segment_cols(["product_category", "id"])
        assert "product_category" in cols


# ── _find_name_col ─────────────────────────────────────────────────────────────


class TestFindNameCol:
    def test_finds_name(self):
        assert _find_name_col(["id", "name", "price"]) == "name"

    def test_finds_nome(self):
        assert _find_name_col(["id", "nome", "prezzo"]) == "nome"

    def test_finds_customer_name(self):
        assert _find_name_col(["id", "customer_name", "amount"]) == "customer_name"

    def test_finds_description(self):
        assert _find_name_col(["id", "description"]) == "description"

    def test_finds_title(self):
        assert _find_name_col(["id", "title", "body"]) == "title"

    def test_no_name_col_returns_none(self):
        assert _find_name_col(["id", "amount", "date"]) is None

    def test_empty_list_returns_none(self):
        assert _find_name_col([]) is None


# ── _parse_formula ─────────────────────────────────────────────────────────────


class TestParseFormula:
    def test_sum_simple(self):
        t, c = _parse_formula("SUM(amount)")
        assert t is None
        assert c == "amount"

    def test_sum_qualified(self):
        t, c = _parse_formula("SUM(orders.total)")
        assert t == "orders"
        assert c == "total"

    def test_avg(self):
        t, c = _parse_formula("AVG(unit_price)")
        assert c == "unit_price"

    def test_count(self):
        t, c = _parse_formula("COUNT(id)")
        assert c == "id"

    def test_count_distinct(self):
        t, c = _parse_formula("COUNT(DISTINCT customer_id)")
        assert c == "customer_id"

    def test_case_insensitive(self):
        t, c = _parse_formula("sum(amount)")
        assert c == "amount"

    def test_no_match_returns_nones(self):
        t, c = _parse_formula("amount + tax")
        assert t is None
        assert c is None

    def test_empty_returns_nones(self):
        t, c = _parse_formula("")
        assert t is None
        assert c is None


# ── generate_templates_from_draft ─────────────────────────────────────────────


MINIMAL_DRAFT = {
    "entities": [
        {
            "name": "Order",
            "table": "orders",
            "columns": ["id", "date", "category", "customer_id", "amount"],
        }
    ],
    "metrics": [
        {
            "name": "revenue",
            "label": "Revenue",
            "formula": "SUM(amount)",
            "unit": "EUR",
        }
    ],
    "relations": [],
}


class TestGenerateTemplates:
    def test_returns_list(self):
        result = generate_templates_from_draft(MINIMAL_DRAFT)
        assert isinstance(result, list)

    def test_returns_templates_for_metrics(self):
        result = generate_templates_from_draft(MINIMAL_DRAFT)
        names = [t["name"] for t in result]
        # Should generate total and average templates for revenue
        assert any("totale" in n.lower() or "total" in n.lower() for n in names)

    def test_each_template_has_required_keys(self):
        result = generate_templates_from_draft(MINIMAL_DRAFT)
        for t in result:
            assert "name" in t
            assert "description" in t
            assert "sql_query" in t
            assert "keywords" in t
            assert "sources" in t

    def test_entity_count_template_generated(self):
        result = generate_templates_from_draft(MINIMAL_DRAFT)
        names = [t["name"].lower() for t in result]
        assert any("quanti" in n or "how many" in n for n in names)

    def test_no_duplicate_names(self):
        result = generate_templates_from_draft(MINIMAL_DRAFT)
        names = [t["name"] for t in result]
        assert len(names) == len(set(names))

    def test_auto_generated_flag(self):
        result = generate_templates_from_draft(MINIMAL_DRAFT)
        for t in result:
            assert t.get("auto_generated") is True

    def test_segment_template_generated_when_segment_col_present(self):
        result = generate_templates_from_draft(MINIMAL_DRAFT)
        names = [t["name"] for t in result]
        # "category" is a segment col — a "per category" template should be generated
        assert any("category" in n.lower() for n in names)

    def test_year_filter_when_date_col(self):
        result = generate_templates_from_draft(MINIMAL_DRAFT)
        # Some templates should use {year} token since draft has "date" column
        sqls = [t["sql_query"] for t in result]
        assert any("{year}" in sql for sql in sqls)

    def test_empty_draft_returns_empty(self):
        result = generate_templates_from_draft(
            {"entities": [], "metrics": [], "relations": []}
        )
        assert result == []

    def test_metric_without_valid_formula_skipped(self):
        draft = {
            "entities": [{"name": "E", "table": "tbl", "columns": ["id"]}],
            "metrics": [
                {
                    "name": "invalid_metric",
                    "label": "Invalid",
                    "formula": "amount + tax",  # no aggregate function
                    "unit": "",
                }
            ],
            "relations": [],
        }
        result = generate_templates_from_draft(draft)
        # No metric templates — but entity count template should still be there
        metric_names = [
            t["name"] for t in result if "invalid_metric" in t.get("sql_query", "")
        ]
        assert len(metric_names) == 0

    def test_top_n_template_generated_when_relation_present(self):
        draft = {
            "entities": [
                {
                    "name": "Order",
                    "table": "orders",
                    "columns": ["id", "date", "customer_id", "amount"],
                },
                {
                    "name": "Customer",
                    "table": "customers",
                    "columns": ["id", "name", "sector"],
                },
            ],
            "metrics": [
                {
                    "name": "revenue",
                    "label": "Revenue",
                    "formula": "SUM(amount)",
                    "unit": "EUR",
                }
            ],
            "relations": [
                {
                    "from_table": "orders",
                    "to_table": "customers",
                    "via_column": "customer_id",
                }
            ],
        }
        result = generate_templates_from_draft(draft)
        names = [t["name"] for t in result]
        # Should produce a Top-N joined template
        assert any("top" in n.lower() or "classifica" in n.lower() for n in names)

    def test_top_n_sql_uses_limit_token(self):
        draft = {
            "entities": [
                {
                    "name": "Order",
                    "table": "orders",
                    "columns": ["id", "date", "customer_id", "amount"],
                },
                {
                    "name": "Customer",
                    "table": "customers",
                    "columns": ["id", "name"],
                },
            ],
            "metrics": [
                {
                    "name": "revenue",
                    "label": "Revenue",
                    "formula": "SUM(amount)",
                    "unit": "",
                }
            ],
            "relations": [
                {
                    "from_table": "orders",
                    "to_table": "customers",
                    "via_column": "customer_id",
                }
            ],
        }
        result = generate_templates_from_draft(draft)
        sqls = [t["sql_query"] for t in result]
        # Top-N template should use {limit}
        assert any("{limit}" in sql for sql in sqls)

    def test_sql_query_is_string(self):
        result = generate_templates_from_draft(MINIMAL_DRAFT)
        for t in result:
            assert isinstance(t["sql_query"], str)

    def test_keywords_is_list(self):
        result = generate_templates_from_draft(MINIMAL_DRAFT)
        for t in result:
            assert isinstance(t["keywords"], list)


class TestKeywordSpaceVariants:
    def test_snake_case_gets_space_variant(self):
        from app.semantic.template_generator import generate_templates_from_draft

        draft = {
            "entities": [
                {
                    "name": "erp_orders",
                    "table": "erp_orders",
                    "columns": ["order_id", "total"],
                }
            ],
            "metrics": [],
            "relations": [],
        }
        tpls = generate_templates_from_draft(draft)
        count_tpl = next(t for t in tpls if t["name"].startswith("How many"))
        # Users type spaces, not underscores.
        assert "how many erp orders" in count_tpl["keywords"]
        assert "how many erp_orders" in count_tpl["keywords"]


class TestUpsertPrunesStaleAutoTemplates:
    def test_renamed_auto_template_retires_old_name(self, tmp_path):
        from app.metadata.catalog import MetadataCatalog

        cat = MetadataCatalog(f"sqlite:///{tmp_path / 'cat.db'}")
        v1 = [
            {
                "name": "Quanti x",
                "sql_query": "SELECT 1",
                "keywords": [],
                "sources": ["x"],
            }
        ]
        cat.upsert_auto_templates(v1)
        v2 = [
            {
                "name": "How many x",
                "sql_query": "SELECT 1",
                "keywords": [],
                "sources": ["x"],
            }
        ]
        cat.upsert_auto_templates(v2)
        names = {t["name"] for t in cat.list_templates()}
        assert "How many x" in names
        assert "Quanti x" not in names  # stale name retired

    def test_templates_on_other_tables_untouched(self, tmp_path):
        from app.metadata.catalog import MetadataCatalog

        cat = MetadataCatalog(f"sqlite:///{tmp_path / 'cat.db'}")
        cat.upsert_auto_templates(
            [
                {
                    "name": "Demo tpl",
                    "sql_query": "SELECT 1",
                    "keywords": [],
                    "sources": ["dipendenti_hr"],
                }
            ]
        )
        # Regenerating templates for a different table must not retire it.
        cat.upsert_auto_templates(
            [
                {
                    "name": "How many x",
                    "sql_query": "SELECT 1",
                    "keywords": [],
                    "sources": ["x"],
                }
            ]
        )
        names = {t["name"] for t in cat.list_templates()}
        assert {"Demo tpl", "How many x"} <= names
