"""Tests for _build_live_funnel — live funnels must contain only real counts."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.main import _build_live_funnel


def test_no_order_like_table_returns_none():
    entities = [
        {"table": "customers", "name": "Customer", "record_count": 100, "columns": []},
        {"table": "products", "name": "Product", "record_count": 50, "columns": []},
    ]
    assert _build_live_funnel(entities) is None


def test_zero_rows_returns_none():
    entities = [
        {"table": "orders", "name": "Order", "record_count": 0, "columns": ["id"]}
    ]
    assert _build_live_funnel(entities) is None


def test_no_status_column_yields_single_real_stage():
    """Without a status column the funnel is just the true total —
    no fabricated 85%/70% decay stages."""
    entities = [
        {
            "table": "sales_orders",
            "name": "SalesOrder",
            "record_count": 1234,
            "columns": ["id", "customer_id", "total"],
        }
    ]
    funnel = _build_live_funnel(entities)
    assert funnel is not None
    assert len(funnel) == 1
    assert funnel[0]["count"] == 1234
    assert "SalesOrder" in funnel[0]["stage"]


def test_unsafe_table_name_skips_status_breakdown():
    """A table name that is not a plain identifier must never reach SQL."""
    entities = [
        {
            "table": 'orders"; DROP TABLE x;--',
            "name": "Order",
            "record_count": 10,
            "columns": ["status"],
        }
    ]
    funnel = _build_live_funnel(entities)
    assert funnel is not None
    assert len(funnel) == 1  # only the total — breakdown skipped
