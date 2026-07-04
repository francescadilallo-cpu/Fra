"""Unit tests for database.py — schema, seeding, get_connection, get_table_counts.

Uses monkeypatching to redirect DB_PATH to a tmp_path so no real DB is touched.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import app.database as db_module
from app.database import get_table_counts


@pytest.fixture()
def tmp_db(tmp_path, monkeypatch):
    """Redirect DB_PATH (and the definitions store dir) to tmp — isolated."""
    monkeypatch.setattr(db_module, "DB_PATH", tmp_path / "test_erp.db")
    monkeypatch.setenv("FRA_DATA_DIR", str(tmp_path / "data"))


# ── get_connection ─────────────────────────────────────────────────────────────


class TestGetConnection:
    def test_returns_sqlite_connection(self, tmp_db):
        conn = db_module.get_connection()
        assert isinstance(conn, sqlite3.Connection)
        conn.close()

    def test_wal_journal_mode(self, tmp_db):
        conn = db_module.get_connection()
        row = conn.execute("PRAGMA journal_mode").fetchone()
        conn.close()
        assert row[0] == "wal"

    def test_foreign_keys_on(self, tmp_db):
        conn = db_module.get_connection()
        row = conn.execute("PRAGMA foreign_keys").fetchone()
        conn.close()
        assert row[0] == 1

    def test_row_factory_returns_rows(self, tmp_db):
        conn = db_module.get_connection()
        conn.execute("CREATE TABLE t (x INTEGER)")
        conn.execute("INSERT INTO t VALUES (99)")
        row = conn.execute("SELECT x FROM t").fetchone()
        conn.close()
        assert row["x"] == 99


# ── init_db ────────────────────────────────────────────────────────────────────


class TestInitDb:
    def test_creates_core_tables(self, tmp_db):
        db_module.init_db()
        conn = db_module.get_connection()
        tables = {
            row["name"]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        conn.close()
        for expected in (
            "customers",
            "products",
            "quotes",
            "quote_lines",
            "orders",
            "order_lines",
        ):
            assert expected in tables

    def test_creates_semantic_tables(self, tmp_db):
        db_module.init_db()
        conn = db_module.get_connection()
        tables = {
            row["name"]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        conn.close()
        for expected in ("sl_metrics", "sl_hierarchies", "sl_segments"):
            assert expected in tables

    def test_seeds_exactly_20_customers(self, tmp_db):
        db_module.init_db()
        conn = db_module.get_connection()
        count = conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
        conn.close()
        assert count == 20

    def test_seeds_all_products(self, tmp_db):
        db_module.init_db()
        conn = db_module.get_connection()
        count = conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
        conn.close()
        assert count == len(db_module.PRODUCT_NAMES)

    def test_seeds_quotes(self, tmp_db):
        db_module.init_db()
        conn = db_module.get_connection()
        count = conn.execute("SELECT COUNT(*) FROM quotes").fetchone()[0]
        conn.close()
        assert count > 0

    def test_seeds_orders(self, tmp_db):
        db_module.init_db()
        conn = db_module.get_connection()
        count = conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
        conn.close()
        assert count > 0

    def test_seeds_builtin_metrics(self, tmp_db):
        db_module.init_db()
        # Builtins are seeded into the persistent definitions store, not the
        # demo fixture DB (user rows must survive deploys).
        from app.definitions_store import get_definitions_connection

        conn = get_definitions_connection()
        count = conn.execute(
            "SELECT COUNT(*) FROM sl_metrics WHERE is_builtin = 1"
        ).fetchone()[0]
        conn.close()
        assert count >= 5

    def test_seeds_builtin_hierarchies(self, tmp_db):
        db_module.init_db()
        # Builtins are seeded into the persistent definitions store, not the
        # demo fixture DB (user rows must survive deploys).
        from app.definitions_store import get_definitions_connection

        conn = get_definitions_connection()
        count = conn.execute(
            "SELECT COUNT(*) FROM sl_hierarchies WHERE is_builtin = 1"
        ).fetchone()[0]
        conn.close()
        assert count >= 3

    def test_seeds_builtin_segments(self, tmp_db):
        db_module.init_db()
        # Builtins are seeded into the persistent definitions store, not the
        # demo fixture DB (user rows must survive deploys).
        from app.definitions_store import get_definitions_connection

        conn = get_definitions_connection()
        count = conn.execute(
            "SELECT COUNT(*) FROM sl_segments WHERE is_builtin = 1"
        ).fetchone()[0]
        conn.close()
        assert count >= 2

    def test_idempotent_customer_count(self, tmp_db):
        db_module.init_db()
        db_module.init_db()  # second call must not duplicate rows
        conn = db_module.get_connection()
        count = conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
        conn.close()
        assert count == 20

    def test_idempotent_metric_count(self, tmp_db):
        db_module.init_db()
        first = (
            db_module.get_connection()
            .execute("SELECT COUNT(*) FROM sl_metrics")
            .fetchone()[0]
        )
        db_module.init_db()
        second = (
            db_module.get_connection()
            .execute("SELECT COUNT(*) FROM sl_metrics")
            .fetchone()[0]
        )
        assert first == second

    def test_customers_have_required_fields(self, tmp_db):
        db_module.init_db()
        conn = db_module.get_connection()
        row = conn.execute("SELECT * FROM customers LIMIT 1").fetchone()
        conn.close()
        assert row["name"] is not None
        assert row["sector"] is not None
        assert row["country"] == "IT"
        assert row["vat_number"].startswith("IT")
        assert row["credit_limit"] > 0

    def test_products_have_unique_skus(self, tmp_db):
        db_module.init_db()
        conn = db_module.get_connection()
        total = conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
        unique = conn.execute("SELECT COUNT(DISTINCT sku) FROM products").fetchone()[0]
        conn.close()
        assert total == unique

    def test_order_lines_reference_valid_orders(self, tmp_db):
        db_module.init_db()
        conn = db_module.get_connection()
        orphans = conn.execute(
            "SELECT COUNT(*) FROM order_lines ol "
            "LEFT JOIN orders o ON ol.order_id = o.id "
            "WHERE o.id IS NULL"
        ).fetchone()[0]
        conn.close()
        assert orphans == 0

    def test_quote_lines_reference_valid_quotes(self, tmp_db):
        db_module.init_db()
        conn = db_module.get_connection()
        orphans = conn.execute(
            "SELECT COUNT(*) FROM quote_lines ql "
            "LEFT JOIN quotes q ON ql.quote_id = q.id "
            "WHERE q.id IS NULL"
        ).fetchone()[0]
        conn.close()
        assert orphans == 0


# ── get_table_counts ───────────────────────────────────────────────────────────


class TestGetTableCounts:
    def test_returns_all_six_tables(self, tmp_db):
        db_module.init_db()
        conn = db_module.get_connection()
        counts = get_table_counts(conn)
        conn.close()
        assert set(counts.keys()) == {
            "customers",
            "products",
            "quotes",
            "quote_lines",
            "orders",
            "order_lines",
        }

    def test_customer_count_matches_seed(self, tmp_db):
        db_module.init_db()
        conn = db_module.get_connection()
        counts = get_table_counts(conn)
        conn.close()
        assert counts["customers"] == 20

    def test_product_count_matches_seed(self, tmp_db):
        db_module.init_db()
        conn = db_module.get_connection()
        counts = get_table_counts(conn)
        conn.close()
        assert counts["products"] == len(db_module.PRODUCT_NAMES)

    def test_all_counts_are_non_negative(self, tmp_db):
        db_module.init_db()
        conn = db_module.get_connection()
        counts = get_table_counts(conn)
        conn.close()
        assert all(v >= 0 for v in counts.values())
