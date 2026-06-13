"""Unit tests for aw_engine pure-utility helpers.

These tests do NOT invoke Claude or DuckDB — they cover the deterministic
helpers that can be exercised in isolation.
"""

from __future__ import annotations

import pytest

from app.query.aw_engine import _build_table_source_map, _extract_json


# ── _extract_json ─────────────────────────────────────────────────────────────


def test_extract_json_plain():
    raw = '{"interpreted_as": "total revenue", "sql": "SELECT 1", "chart_hint": null}'
    result = _extract_json(raw)
    assert result["interpreted_as"] == "total revenue"
    assert result["sql"] == "SELECT 1"
    assert result["chart_hint"] is None


def test_extract_json_markdown_fence():
    raw = '```json\n{"sql": "SELECT 2"}\n```'
    result = _extract_json(raw)
    assert result["sql"] == "SELECT 2"


def test_extract_json_markdown_fence_no_language():
    raw = '```\n{"sql": "SELECT 3"}\n```'
    result = _extract_json(raw)
    assert result["sql"] == "SELECT 3"


def test_extract_json_embedded_in_text():
    raw = 'Sure! Here is the result: {"sql": "SELECT 4"} Done.'
    result = _extract_json(raw)
    assert result["sql"] == "SELECT 4"


def test_extract_json_nested_object():
    raw = '{"sql": "SELECT 5", "chart_hint": {"type": "bar", "label_col": "name"}}'
    result = _extract_json(raw)
    assert result["chart_hint"]["type"] == "bar"


def test_extract_json_raises_on_unparseable():
    with pytest.raises(ValueError, match="Could not parse JSON"):
        _extract_json("this is not json at all")


def test_extract_json_strips_leading_whitespace():
    raw = '   \n  {"sql": "SELECT 6"}  '
    result = _extract_json(raw)
    assert result["sql"] == "SELECT 6"


# ── _build_table_source_map ───────────────────────────────────────────────────


def _make_entity(sources):
    """Return a minimal entity-like object."""
    from types import SimpleNamespace

    return SimpleNamespace(sources=sources)


def test_build_table_source_map_single_entity():
    from unittest.mock import MagicMock

    catalog = MagicMock()
    catalog.list_entities.return_value = ["SalesOrder"]
    entity = _make_entity([{"source": "erp", "table": "SalesOrder"}])
    catalog.get_entity.return_value = entity

    mapping = _build_table_source_map(catalog)
    assert mapping == {"SalesOrder": "erp"}


def test_build_table_source_map_multiple_entities():
    from unittest.mock import MagicMock

    catalog = MagicMock()
    catalog.list_entities.return_value = ["SalesOrder", "Customer"]

    def _get(name):
        if name == "SalesOrder":
            return _make_entity([{"source": "erp"}])
        return _make_entity([{"source": "crm"}])

    catalog.get_entity.side_effect = _get

    mapping = _build_table_source_map(catalog)
    assert mapping["SalesOrder"] == "erp"
    assert mapping["Customer"] == "crm"


def test_build_table_source_map_entity_without_source_key():
    from unittest.mock import MagicMock

    catalog = MagicMock()
    catalog.list_entities.return_value = ["Orphan"]
    catalog.get_entity.return_value = _make_entity([{"table": "orphan_tbl"}])

    mapping = _build_table_source_map(catalog)
    assert mapping == {}


def test_build_table_source_map_none_entity():
    from unittest.mock import MagicMock

    catalog = MagicMock()
    catalog.list_entities.return_value = ["Ghost"]
    catalog.get_entity.return_value = None

    mapping = _build_table_source_map(catalog)
    assert mapping == {}


def test_build_table_source_map_uses_first_source_only():
    from unittest.mock import MagicMock

    catalog = MagicMock()
    catalog.list_entities.return_value = ["Multi"]
    catalog.get_entity.return_value = _make_entity(
        [{"source": "primary"}, {"source": "secondary"}]
    )

    mapping = _build_table_source_map(catalog)
    # Only the first source with a "source" key is used
    assert mapping["Multi"] == "primary"


def test_build_table_source_map_catalog_raises_returns_empty():
    from unittest.mock import MagicMock

    catalog = MagicMock()
    catalog.list_entities.side_effect = RuntimeError("db down")

    mapping = _build_table_source_map(catalog)
    assert mapping == {}
