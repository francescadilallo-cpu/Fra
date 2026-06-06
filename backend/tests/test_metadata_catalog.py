"""Unit tests for MetadataCatalog — metadata/catalog.py.

Uses an in-memory SQLite database so no files are created.
Tests CRUD, upsert semantics, draft editing, query templates,
and the get_draft_entities / prune_phantom_entities optimizations.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.metadata.catalog import MetadataCatalog


@pytest.fixture()
def cat() -> MetadataCatalog:
    return MetadataCatalog()  # in-memory SQLite


# ── Entity CRUD ───────────────────────────────────────────────────────────────


class TestEntityCRUD:
    def test_empty_catalog(self, cat):
        assert cat.list_entities() == []

    def test_upsert_and_get_entity(self, cat):
        with cat._Session() as s:
            cat._upsert_entity(
                s,
                name="Customer",
                description="CRM customer",
                primary_key="accountId",
                sources=[{"source": "crm", "table": "customers"}],
                record_count=100,
                freshness="2024-01-01T00:00:00",
                quality_flags={"duplicates_detected": False},
                kg_node_count=95,
            )
            s.commit()
        entity = cat.get_entity("Customer")
        assert entity is not None
        assert entity.name == "Customer"
        assert entity.record_count == 100
        assert entity.kg_node_count == 95

    def test_list_entities(self, cat):
        with cat._Session() as s:
            for name in ("Customer", "SalesOrder", "Product"):
                cat._upsert_entity(
                    s,
                    name=name,
                    description="",
                    primary_key="id",
                    sources=[],
                    record_count=0,
                    freshness="",
                    quality_flags={},
                    kg_node_count=0,
                )
            s.commit()
        assert set(cat.list_entities()) == {"Customer", "SalesOrder", "Product"}

    def test_get_missing_entity_returns_none(self, cat):
        assert cat.get_entity("DoesNotExist") is None

    def test_upsert_updates_existing(self, cat):
        with cat._Session() as s:
            cat._upsert_entity(
                s,
                name="E",
                description="old",
                primary_key="id",
                sources=[],
                record_count=10,
                freshness="",
                quality_flags={},
                kg_node_count=0,
            )
            s.commit()
        with cat._Session() as s:
            cat._upsert_entity(
                s,
                name="E",
                description="new",
                primary_key="id",
                sources=[],
                record_count=20,
                freshness="",
                quality_flags={},
                kg_node_count=5,
            )
            s.commit()
        entity = cat.get_entity("E")
        assert entity is not None
        assert entity.description == "new"
        assert entity.record_count == 20


# ── Attribute CRUD ────────────────────────────────────────────────────────────


class TestAttributeCRUD:
    def test_upsert_and_get_attribute(self, cat):
        with cat._Session() as s:
            cat._upsert_attribute(
                s,
                entity="Customer",
                attribute="revenue",
                data_type="float",
                nullability_rate=0.0,
                business_definition="Annual revenue",
                source_path="crm.customers.revenue",
                sample_values=["1000", "2000"],
                lineage_edges=[],
            )
            s.commit()
        attr = cat.get_attribute("Customer", "revenue")
        assert attr is not None
        assert attr.data_type == "float"
        assert attr.source_path == "crm.customers.revenue"
        assert attr.sample_values == ["1000", "2000"]

    def test_get_missing_attribute_returns_none(self, cat):
        assert cat.get_attribute("Customer", "nonexistent") is None

    def test_upsert_updates_existing_attribute(self, cat):
        with cat._Session() as s:
            cat._upsert_attribute(
                s,
                entity="E",
                attribute="a",
                data_type="str",
                nullability_rate=0.0,
                business_definition="old",
                source_path="",
                sample_values=[],
                lineage_edges=[],
            )
            s.commit()
        with cat._Session() as s:
            cat._upsert_attribute(
                s,
                entity="E",
                attribute="a",
                data_type="int",
                nullability_rate=0.1,
                business_definition="new",
                source_path="x.y.z",
                sample_values=["1"],
                lineage_edges=[{"m": "rev"}],
            )
            s.commit()
        attr = cat.get_attribute("E", "a")
        assert attr is not None
        assert attr.data_type == "int"
        assert attr.nullability_rate == pytest.approx(0.1)
        assert attr.business_definition == "new"


# ── Metric CRUD ───────────────────────────────────────────────────────────────


class TestMetricCRUD:
    def test_populate_seeds_default_metrics(self, cat):
        with cat._Session() as s:
            cat._populate_metrics(s, None)
            s.commit()
        metrics = cat.list_metrics()
        assert "revenue" in metrics
        assert "active_customers" in metrics

    def test_get_metric(self, cat):
        with cat._Session() as s:
            cat._populate_metrics(s, None)
            s.commit()
        m = cat.get_metric("revenue")
        assert m is not None
        assert "subtotal" in m.formula.lower() or "SUM" in m.formula

    def test_get_missing_metric_returns_none(self, cat):
        assert cat.get_metric("does_not_exist") is None

    def test_list_metric_objects(self, cat):
        with cat._Session() as s:
            cat._populate_metrics(s, None)
            s.commit()
        objects = cat.list_metric_objects()
        assert len(objects) >= 1
        assert all(hasattr(m, "name") for m in objects)


# ── Draft editing ─────────────────────────────────────────────────────────────


class TestDraftEditing:
    def _seed_entity(self, cat, name="Customer"):
        with cat._Session() as s:
            cat._upsert_entity(
                s,
                name=name,
                description="Desc",
                primary_key="id",
                sources=[{"source": "crm", "table": name.lower()}],
                record_count=5,
                freshness="",
                quality_flags={},
                kg_node_count=0,
            )
            s.commit()

    def test_save_entity_draft_user_description(self, cat):
        self._seed_entity(cat)
        ok = cat.save_entity_draft("Customer", user_description="My override")
        assert ok is True
        e = cat.get_entity("Customer")
        assert e is not None
        assert e.user_description == "My override"

    def test_save_entity_draft_context_notes(self, cat):
        self._seed_entity(cat)
        cat.save_entity_draft("Customer", context_notes="Use dedup view only")
        e = cat.get_entity("Customer")
        assert e is not None
        assert e.context_notes == "Use dedup view only"

    def test_save_entity_draft_missing_returns_false(self, cat):
        assert cat.save_entity_draft("DoesNotExist", user_description="X") is False

    def test_save_metric_draft(self, cat):
        with cat._Session() as s:
            cat._populate_metrics(s, None)
            s.commit()
        ok = cat.save_metric_draft("revenue", description="Updated desc", label="Rev")
        assert ok is True
        m = cat.get_metric("revenue")
        assert m is not None
        assert m.description == "Updated desc"
        assert m.label == "Rev"

    def test_save_metric_draft_missing_returns_false(self, cat):
        assert cat.save_metric_draft("ghost_metric", description="X") is False


# ── get_draft_entities (N+1 fix) ──────────────────────────────────────────────


class TestGetDraftEntities:
    def test_returns_list_with_columns(self, cat):
        with cat._Session() as s:
            cat._upsert_entity(
                s,
                name="SalesOrder",
                description="SO",
                primary_key="order_id",
                sources=[{"source": "erp", "table": "sales_order_header"}],
                record_count=1000,
                freshness="",
                quality_flags={},
                kg_node_count=0,
            )
            cat._upsert_attribute(
                s,
                entity="SalesOrder",
                attribute="total_due",
                data_type="float",
                nullability_rate=0.0,
                business_definition="",
                source_path="",
                sample_values=[],
                lineage_edges=[],
            )
            cat._upsert_attribute(
                s,
                entity="SalesOrder",
                attribute="order_date",
                data_type="date",
                nullability_rate=0.0,
                business_definition="",
                source_path="",
                sample_values=[],
                lineage_edges=[],
            )
            s.commit()
        drafts = cat.get_draft_entities()
        assert len(drafts) == 1
        draft = drafts[0]
        assert draft["name"] == "SalesOrder"
        assert set(draft["columns"]) == {"total_due", "order_date"}
        assert draft["table"] == "sales_order_header"

    def test_entity_without_attributes_has_empty_columns(self, cat):
        with cat._Session() as s:
            cat._upsert_entity(
                s,
                name="Territory",
                description="",
                primary_key="id",
                sources=[],
                record_count=0,
                freshness="",
                quality_flags={},
                kg_node_count=0,
            )
            s.commit()
        drafts = cat.get_draft_entities()
        assert any(d["columns"] == [] for d in drafts if d["name"] == "Territory")

    def test_multiple_entities_grouped_correctly(self, cat):
        with cat._Session() as s:
            for name in ("A", "B"):
                cat._upsert_entity(
                    s,
                    name=name,
                    description="",
                    primary_key="id",
                    sources=[],
                    record_count=0,
                    freshness="",
                    quality_flags={},
                    kg_node_count=0,
                )
                cat._upsert_attribute(
                    s,
                    entity=name,
                    attribute=f"{name}_col",
                    data_type="str",
                    nullability_rate=0.0,
                    business_definition="",
                    source_path="",
                    sample_values=[],
                    lineage_edges=[],
                )
            s.commit()
        drafts = {d["name"]: d for d in cat.get_draft_entities()}
        assert drafts["A"]["columns"] == ["A_col"]
        assert drafts["B"]["columns"] == ["B_col"]


# ── prune_phantom_entities ────────────────────────────────────────────────────


class TestPrunePhantomEntities:
    def test_removes_entities_absent_from_duckdb(self, cat):
        with cat._Session() as s:
            cat._upsert_entity(
                s,
                name="Ghost",
                description="",
                primary_key="id",
                sources=[{"source": "erp", "table": "ghost_table"}],
                record_count=0,
                freshness="",
                quality_flags={},
                kg_node_count=0,
            )
            cat._upsert_entity(
                s,
                name="Real",
                description="",
                primary_key="id",
                sources=[{"source": "erp", "table": "real_table"}],
                record_count=0,
                freshness="",
                quality_flags={},
                kg_node_count=0,
            )
            s.commit()
        removed = cat.prune_phantom_entities(frozenset({"real_table"}))
        assert removed == 1
        assert cat.get_entity("Ghost") is None
        assert cat.get_entity("Real") is not None

    def test_also_removes_orphaned_attributes(self, cat):
        with cat._Session() as s:
            cat._upsert_entity(
                s,
                name="GhostE",
                description="",
                primary_key="id",
                sources=[{"source": "x", "table": "phantom"}],
                record_count=0,
                freshness="",
                quality_flags={},
                kg_node_count=0,
            )
            cat._upsert_attribute(
                s,
                entity="GhostE",
                attribute="col1",
                data_type="str",
                nullability_rate=0.0,
                business_definition="",
                source_path="",
                sample_values=[],
                lineage_edges=[],
            )
            s.commit()
        cat.prune_phantom_entities(frozenset())
        assert cat.get_attribute("GhostE", "col1") is None

    def test_no_phantom_returns_zero(self, cat):
        with cat._Session() as s:
            cat._upsert_entity(
                s,
                name="Real2",
                description="",
                primary_key="id",
                sources=[{"source": "x", "table": "t_real"}],
                record_count=0,
                freshness="",
                quality_flags={},
                kg_node_count=0,
            )
            s.commit()
        removed = cat.prune_phantom_entities(frozenset({"t_real"}))
        assert removed == 0


# ── Schema-context caching ────────────────────────────────────────────────────


def _seed_entity(cat, name: str, table: str) -> None:
    with cat._Session() as s:
        cat._upsert_entity(
            s,
            name=name,
            description="",
            primary_key="id",
            sources=[{"source": "duckdb_unified", "table": table}],
            record_count=10,
            freshness="",
            quality_flags={},
            kg_node_count=0,
        )
        cat._upsert_attribute(
            s,
            entity=name,
            attribute="id",
            data_type="integer",
            nullability_rate=0.0,
            business_definition="",
            source_path="",
            sample_values=[],
            lineage_edges=[],
        )
        s.commit()


class TestSchemaContextCache:
    def test_schema_context_includes_table(self, cat):
        _seed_entity(cat, "Orders", "orders")
        ctx = cat.get_schema_context()
        assert "orders" in ctx

    def test_result_is_memoised(self, cat):
        _seed_entity(cat, "Orders", "orders")
        first = cat.get_schema_context()
        # Second call returns the exact same cached object (identity check).
        second = cat.get_schema_context()
        assert first is second

    def test_cache_keyed_by_max_tables(self, cat):
        _seed_entity(cat, "Orders", "orders")
        a = cat.get_schema_context(max_tables=5)
        b = cat.get_schema_context(max_tables=10)
        # Different max_tables → independent cache entries.
        assert 5 in cat._schema_ctx_cache
        assert 10 in cat._schema_ctx_cache
        assert a is cat._schema_ctx_cache[5]
        assert b is cat._schema_ctx_cache[10]

    def test_prune_invalidates_cache(self, cat):
        _seed_entity(cat, "Ghost", "ghost_table")
        _seed_entity(cat, "Real", "real_table")
        before = cat.get_schema_context()
        assert "ghost_table" in before
        cat.prune_phantom_entities(frozenset({"real_table"}))
        after = cat.get_schema_context()
        # Cache was invalidated, so the pruned table no longer appears.
        assert "ghost_table" not in after
        assert "real_table" in after

    def test_invalidate_clears_cache(self, cat):
        _seed_entity(cat, "Orders", "orders")
        cat.get_schema_context()
        assert cat._schema_ctx_cache  # populated
        cat._invalidate_schema_context_cache()
        assert cat._schema_ctx_cache == {}


# ── Query templates ───────────────────────────────────────────────────────────


class TestQueryTemplates:
    def test_create_and_list_template(self, cat):
        result = cat.create_template(
            name="top_customers",
            description="Top 10 customers by revenue",
            sql_query="SELECT customer_ref, SUM(subtotal_amount) FROM orders GROUP BY 1 ORDER BY 2 DESC LIMIT 10",
            keywords=["top", "customers", "revenue"],
            sources=["erp"],
        )
        assert "id" in result
        templates = cat.list_templates()
        assert len(templates) == 1
        assert templates[0]["name"] == "top_customers"
        assert templates[0]["keywords"] == ["top", "customers", "revenue"]

    def test_update_template(self, cat):
        created = cat.create_template(
            name="q1",
            description="old",
            sql_query="SELECT 1",
            keywords=[],
            sources=[],
        )
        cat.update_template(created["id"], description="new desc", sql_query="SELECT 2")
        templates = cat.list_templates()
        assert templates[0]["description"] == "new desc"
        assert templates[0]["sql_query"] == "SELECT 2"

    def test_delete_template_soft_deletes(self, cat):
        created = cat.create_template(
            name="q2", description="", sql_query="SELECT 1", keywords=[], sources=[]
        )
        cat.delete_template(created["id"])
        assert cat.list_templates(active_only=True) == []
        assert len(cat.list_templates(active_only=False)) == 1

    def test_upsert_auto_template(self, cat):
        count = cat.upsert_auto_templates(
            [
                {
                    "name": "auto_q",
                    "sql_query": "SELECT 1",
                    "keywords": ["a"],
                    "sources": ["erp"],
                    "description": "auto",
                },
            ]
        )
        assert count == 1
        templates = cat.list_templates()
        assert templates[0]["auto_generated"] is True

    def test_upsert_auto_does_not_overwrite_user_template(self, cat):
        cat.create_template(
            name="shared",
            description="user-owned",
            sql_query="SELECT 1",
            keywords=[],
            sources=[],
        )
        count = cat.upsert_auto_templates(
            [
                {
                    "name": "shared",
                    "sql_query": "SELECT 2",
                    "keywords": [],
                    "sources": [],
                },
            ]
        )
        assert count == 0
        templates = cat.list_templates()
        assert templates[0]["sql_query"] == "SELECT 1"

    def test_row_count(self, cat):
        assert cat.row_count() == 0
        with cat._Session() as s:
            cat._populate_metrics(s, None)
            s.commit()
        assert cat.row_count() >= 4  # 4 default metrics seeded


# ── _sample_rows / _count_rows module helpers ────────────────────────────────


class TestSampleRowsLimitPassthrough:
    """mgr.execute() itself caps results at 100 rows by default — _sample_rows
    must forward its own *limit* (default 200) so a wider sample isn't
    silently truncated to half its requested size."""

    def test_sample_rows_passes_limit_through_to_mgr_execute(self):
        from app.metadata.catalog import _sample_rows

        mgr = MagicMock()
        mgr.execute.return_value = [{"id": 1}]

        _sample_rows("orders", adapter=None, mgr=mgr, limit=200)

        args, kwargs = mgr.execute.call_args
        assert kwargs.get("limit") == 200

    def test_sample_rows_default_limit_is_200(self):
        from app.metadata.catalog import _sample_rows

        mgr = MagicMock()
        mgr.execute.return_value = []

        _sample_rows("orders", adapter=None, mgr=mgr)

        _, kwargs = mgr.execute.call_args
        assert kwargs.get("limit") == 200

    def test_sample_rows_falls_back_to_adapter_without_limit_kwarg(self):
        from app.metadata.catalog import _sample_rows

        adapter = MagicMock()
        adapter.execute_query.return_value = [{"id": 1}, {"id": 2}]

        rows = _sample_rows("orders", adapter=adapter, mgr=None, limit=50)

        assert rows == [{"id": 1}, {"id": 2}]
        adapter.execute_query.assert_called_once()
        _, kwargs = adapter.execute_query.call_args
        assert "limit" not in kwargs

    def test_sample_rows_swallows_mgr_errors(self):
        from app.metadata.catalog import _sample_rows

        mgr = MagicMock()
        mgr.execute.side_effect = RuntimeError("boom")

        assert _sample_rows("orders", adapter=None, mgr=mgr) == []


# ── _get_available_tables (table-listing — must NOT cap at 100) ───────────────


class TestGetAvailableTables:
    """mgr.execute() silently caps results at 100 rows — using it for
    SHOW TABLES would make _populate_* skip real entities whenever a
    deployment has more than 100 tables and the relevant table name sorts
    past the cutoff. _get_available_tables must use execute_all() instead,
    which respects no implicit cap."""

    def test_uses_execute_all_not_capped_execute(self, cat):
        mgr = MagicMock()
        mgr.execute_all.return_value = [{"name": "orders"}, {"name": "customers"}]

        available = cat._get_available_tables(mgr=mgr)

        assert available == {"orders", "customers"}
        mgr.execute_all.assert_called_once_with("SHOW TABLES")
        mgr.execute.assert_not_called()

    def test_returns_more_than_100_tables(self, cat):
        """Regression: a naïve mgr.execute("SHOW TABLES") would silently
        truncate to 100 names, hiding any table beyond that from the
        availability check used to gate entity population."""
        names = [f"table_{i:03d}" for i in range(150)]
        mgr = MagicMock()
        mgr.execute_all.return_value = [{"name": n} for n in names]

        available = cat._get_available_tables(mgr=mgr)

        assert len(available) == 150
        assert "table_149" in available

    def test_falls_back_to_schema_info_when_show_tables_empty(self, cat):
        mgr = MagicMock()
        mgr.execute_all.return_value = []
        mgr.get_schema_info.return_value = {"orders": {}, "customers": {}}

        available = cat._get_available_tables(mgr=mgr)

        assert available == {"orders", "customers"}

    def test_swallows_mgr_errors_returns_empty_set(self, cat):
        mgr = MagicMock()
        mgr.execute_all.side_effect = RuntimeError("boom")

        assert cat._get_available_tables(mgr=mgr) == set()
