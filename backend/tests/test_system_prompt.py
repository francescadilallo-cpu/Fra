"""Tests for the dynamic LLM system prompt (semantic/system_prompt.py)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.semantic.system_prompt import build_system_prompt


class TestBuildSystemPrompt:
    def test_contains_sql_rules_and_response_format(self):
        result = build_system_prompt()
        assert "DuckDB" in result
        assert "interpreted_as" in result and "sql" in result
        assert "100" in result  # LIMIT rule
        assert "read-only" in result.lower() or "SELECT" in result

    def test_without_catalog_includes_fallback(self):
        assert "No schema information" in build_system_prompt(catalog=None)

    def test_with_catalog_includes_schema(self):
        catalog = MagicMock()
        catalog.get_schema_context.return_value = "TABLE orders (id, status, total)"
        assert "orders" in build_system_prompt(catalog=catalog)

    def test_with_catalog_schema_error_falls_back(self):
        catalog = MagicMock()
        catalog.get_schema_context.side_effect = RuntimeError("DB unavailable")
        assert isinstance(build_system_prompt(catalog=catalog), str)

    def test_exclude_tables_forwarded_to_catalog(self):
        catalog = MagicMock()
        catalog.get_schema_context.return_value = "TABLE x (id)"
        build_system_prompt(catalog=catalog, exclude_tables=frozenset({"demo_t"}))
        catalog.get_schema_context.assert_called_once_with(
            exclude_tables=frozenset({"demo_t"})
        )

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
        assert "BRIDGE" in result and "Order" in result

    def test_with_layer_no_relations_no_bridge_section(self):
        layer = MagicMock()
        draft = MagicMock()
        draft.relations = []
        layer.draft = draft
        assert "BRIDGE RELATIONSHIPS" not in build_system_prompt(layer=layer)
