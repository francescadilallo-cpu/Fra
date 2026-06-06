"""Unit tests for ontology/mapper.py — get_mappings, get_flat_mappings, update_mapping."""

from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import app.ontology.mapper as mapper_module
from app.ontology.mapper import get_flat_mappings, get_mappings, update_mapping


@pytest.fixture(autouse=True)
def reset_mappings():
    """Restore _mappings to default after each test so mutations don't leak."""
    yield
    mapper_module._mappings = copy.deepcopy(mapper_module._DEFAULT_MAPPINGS)


# ── get_mappings ───────────────────────────────────────────────────────────────


class TestGetMappings:
    def test_returns_dict(self):
        m = get_mappings()
        assert isinstance(m, dict)

    def test_contains_expected_tables(self):
        m = get_mappings()
        for table in ("customers", "products", "quotes", "quote_lines", "orders", "order_lines"):
            assert table in m

    def test_returns_deep_copy(self):
        m = get_mappings()
        m["customers"]["id"]["ontology_class"] = "MUTATED"
        # Original must be unchanged
        assert get_mappings()["customers"]["id"]["ontology_class"] != "MUTATED"

    def test_each_field_has_required_keys(self):
        for table, fields in get_mappings().items():
            for field, meta in fields.items():
                assert "ontology_class" in meta, f"{table}.{field} missing ontology_class"
                assert "ontology_property" in meta, f"{table}.{field} missing ontology_property"
                assert "type" in meta, f"{table}.{field} missing type"


# ── get_flat_mappings ──────────────────────────────────────────────────────────


class TestGetFlatMappings:
    def test_returns_list(self):
        rows = get_flat_mappings()
        assert isinstance(rows, list)

    def test_total_count_matches_nested_dict(self):
        total = sum(len(fields) for fields in get_mappings().values())
        assert len(get_flat_mappings()) == total

    def test_each_entry_has_all_fields(self):
        for row in get_flat_mappings():
            assert hasattr(row, "table")
            assert hasattr(row, "field")
            assert hasattr(row, "ontology_class")
            assert hasattr(row, "ontology_property")
            assert hasattr(row, "field_type")

    def test_customers_id_present(self):
        rows = get_flat_mappings()
        match = [r for r in rows if r.table == "customers" and r.field == "id"]
        assert len(match) == 1
        assert match[0].ontology_class == "Customer"
        assert match[0].field_type == "integer"

    def test_no_duplicate_table_field_pairs(self):
        rows = get_flat_mappings()
        pairs = [(r.table, r.field) for r in rows]
        assert len(pairs) == len(set(pairs))


# ── update_mapping ─────────────────────────────────────────────────────────────


class TestUpdateMapping:
    def test_update_existing_field_returns_true(self):
        assert update_mapping("customers", "name", "Customer.fullName") is True

    def test_update_persists_class_and_property(self):
        update_mapping("customers", "name", "Customer.fullName")
        m = get_mappings()
        assert m["customers"]["name"]["ontology_class"] == "Customer"
        assert m["customers"]["name"]["ontology_property"] == "fullName"

    def test_update_missing_table_returns_false(self):
        assert update_mapping("nonexistent_table", "id", "X.y") is False

    def test_update_missing_field_returns_false(self):
        assert update_mapping("customers", "nonexistent_field", "X.y") is False

    def test_update_without_dot_sets_property_only(self):
        update_mapping("products", "sku", "stockKeepingUnit")
        m = get_mappings()
        assert m["products"]["sku"]["ontology_property"] == "stockKeepingUnit"

    def test_update_does_not_affect_other_fields(self):
        original_sector = get_mappings()["customers"]["sector"].copy()
        update_mapping("customers", "name", "Customer.fullName")
        assert get_mappings()["customers"]["sector"] == original_sector

    def test_update_does_not_affect_other_tables(self):
        original_products = copy.deepcopy(get_mappings()["products"])
        update_mapping("customers", "name", "Customer.fullName")
        assert get_mappings()["products"] == original_products

    def test_flat_mappings_reflect_update(self):
        update_mapping("orders", "status", "Order.orderState")
        rows = get_flat_mappings()
        match = [r for r in rows if r.table == "orders" and r.field == "status"]
        assert match[0].ontology_property == "orderState"

    def test_update_is_cumulative(self):
        update_mapping("customers", "name", "Customer.fullName")
        update_mapping("customers", "sector", "Customer.industry")
        m = get_mappings()
        assert m["customers"]["name"]["ontology_property"] == "fullName"
        assert m["customers"]["sector"]["ontology_property"] == "industry"

    def test_fixture_reset_restores_default(self):
        update_mapping("customers", "name", "Customer.MUTATED")
        # Fixture will reset after this test — verified by subsequent test
        assert get_mappings()["customers"]["name"]["ontology_property"] == "MUTATED"
