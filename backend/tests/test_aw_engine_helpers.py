"""Unit tests for pure helpers in query/aw_engine.py — no Anthropic API needed."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.query.aw_engine import (
    _build_table_source_map,
    _extract_json,
    build_system_prompt,
)


# ── _extract_json ──────────────────────────────────────────────────────────────


class TestExtractJson:
    def test_plain_json(self):
        result = _extract_json('{"sql": "SELECT 1", "interpreted_as": "test"}')
        assert result["sql"] == "SELECT 1"

    def test_json_in_code_fence(self):
        text = '```json\n{"sql": "SELECT 1"}\n```'
        result = _extract_json(text)
        assert result["sql"] == "SELECT 1"

    def test_json_in_plain_fence(self):
        text = '```\n{"sql": "SELECT COUNT(*) FROM orders"}\n```'
        result = _extract_json(text)
        assert "orders" in result["sql"]

    def test_json_embedded_in_text(self):
        text = 'Here is my analysis: {"sql": "SELECT 1", "interpreted_as": "count"}'
        result = _extract_json(text)
        assert result["sql"] == "SELECT 1"

    def test_no_json_raises_value_error(self):
        with pytest.raises(ValueError, match="Could not parse JSON"):
            _extract_json("No JSON here at all.")

    def test_whitespace_stripped(self):
        result = _extract_json('  {"key": "value"}  ')
        assert result["key"] == "value"

    def test_nested_json_preserved(self):
        text = '{"sql": "SELECT 1", "chart_hint": {"type": "bar", "value_col": "amt"}}'
        result = _extract_json(text)
        assert result["chart_hint"]["type"] == "bar"


# ── build_system_prompt ────────────────────────────────────────────────────────


class TestBuildSystemPrompt:
    def test_returns_string(self):
        result = build_system_prompt()
        assert isinstance(result, str)

    def test_contains_sql_rules(self):
        result = build_system_prompt()
        assert "DuckDB" in result

    def test_contains_response_format(self):
        result = build_system_prompt()
        assert "interpreted_as" in result
        assert "sql" in result

    def test_without_catalog_includes_fallback(self):
        result = build_system_prompt(catalog=None)
        assert "No schema information" in result

    def test_with_catalog_includes_schema(self):
        catalog = MagicMock()
        catalog.get_schema_context.return_value = "TABLE orders (id, status, total)"
        result = build_system_prompt(catalog=catalog)
        assert "orders" in result

    def test_with_catalog_schema_error_falls_back(self):
        catalog = MagicMock()
        catalog.get_schema_context.side_effect = RuntimeError("DB unavailable")
        result = build_system_prompt(catalog=catalog)
        assert isinstance(result, str)

    def test_with_layer_includes_bridge_relationships(self):
        layer = MagicMock()
        draft = MagicMock()
        draft.relations = [
            {
                "from_entity": "Order",
                "to_entity": "Customer",
                "from_field": "customer_id",
                "to_field": "id",
            }
        ]
        layer.draft = draft
        result = build_system_prompt(layer=layer)
        assert "BRIDGE" in result or "Order" in result

    def test_with_layer_no_relations_no_bridge_section(self):
        layer = MagicMock()
        draft = MagicMock()
        draft.relations = []
        layer.draft = draft
        result = build_system_prompt(layer=layer)
        # No relations — BRIDGE section should be absent
        assert "BRIDGE RELATIONSHIPS" not in result

    def test_select_only_rule_present(self):
        result = build_system_prompt()
        assert "read-only" in result.lower() or "SELECT" in result

    def test_limit_100_rule_present(self):
        result = build_system_prompt()
        assert "100" in result


# ── _build_table_source_map ────────────────────────────────────────────────────


class TestBuildTableSourceMap:
    def test_empty_catalog_returns_empty_dict(self):
        catalog = MagicMock()
        catalog.list_entities.return_value = []
        result = _build_table_source_map(catalog)
        assert result == {}

    def test_maps_entity_to_source(self):
        catalog = MagicMock()
        catalog.list_entities.return_value = ["SalesOrder"]
        entity = MagicMock()
        entity.sources = [{"source": "erp", "table": "sales_order_header"}]
        catalog.get_entity.return_value = entity
        result = _build_table_source_map(catalog)
        assert result.get("SalesOrder") == "erp"

    def test_entity_with_no_source_skipped(self):
        catalog = MagicMock()
        catalog.list_entities.return_value = ["Unknown"]
        entity = MagicMock()
        entity.sources = []
        catalog.get_entity.return_value = entity
        result = _build_table_source_map(catalog)
        assert "Unknown" not in result

    def test_catalog_exception_returns_empty(self):
        catalog = MagicMock()
        catalog.list_entities.side_effect = RuntimeError("DB error")
        result = _build_table_source_map(catalog)
        assert result == {}

    def test_get_entity_none_skipped(self):
        catalog = MagicMock()
        catalog.list_entities.return_value = ["MissingEntity"]
        catalog.get_entity.return_value = None
        result = _build_table_source_map(catalog)
        assert "MissingEntity" not in result
