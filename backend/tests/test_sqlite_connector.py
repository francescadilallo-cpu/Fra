"""Unit tests for connectors/sqlite_connector.py.

Uses an in-memory SQLite database created in tmp_path so no real CRM
file is required.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.connectors.sqlite_connector import (
    ENTITY_TABLE_MAP,
    KNOWN_TABLES,
    SQLiteConnector,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

CRM_SCHEMA = """
CREATE TABLE IF NOT EXISTS account (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    account_number TEXT,
    customer_type TEXT
);
CREATE TABLE IF NOT EXISTS contact (
    id INTEGER PRIMARY KEY,
    account_id INTEGER,
    first_name TEXT,
    last_name TEXT,
    email TEXT
);
CREATE TABLE IF NOT EXISTS address (
    id INTEGER PRIMARY KEY,
    account_id INTEGER,
    street TEXT,
    city TEXT
);
CREATE TABLE IF NOT EXISTS account_address (
    id INTEGER PRIMARY KEY,
    account_id INTEGER,
    address_id INTEGER
);
CREATE TABLE IF NOT EXISTS state_province (
    id INTEGER PRIMARY KEY,
    name TEXT,
    code TEXT
);
CREATE TABLE IF NOT EXISTS country (
    id INTEGER PRIMARY KEY,
    name TEXT,
    code TEXT
);
"""


@pytest.fixture()
def crm_db(tmp_path) -> Path:
    """Create a minimal CRM SQLite DB and return its path."""
    db_path = tmp_path / "clienthub.db"
    conn = sqlite3.connect(str(db_path))
    conn.executescript(CRM_SCHEMA)
    # Insert a few rows
    conn.execute(
        "INSERT INTO account (name, account_number, customer_type) VALUES ('Acme Corp', 'C001', 'Company')"
    )
    conn.execute(
        "INSERT INTO account (name, account_number, customer_type) VALUES ('Bob Smith', 'C002', 'Individual')"
    )
    conn.execute(
        "INSERT INTO contact (account_id, first_name, last_name, email) VALUES (1, 'Alice', 'Johnson', 'alice@acme.com')"
    )
    conn.execute("INSERT INTO state_province (name, code) VALUES ('Lombardia', 'LOM')")
    conn.execute("INSERT INTO country (name, code) VALUES ('Italy', 'IT')")
    conn.commit()
    conn.close()
    return db_path


@pytest.fixture()
def connector(crm_db) -> SQLiteConnector:
    return SQLiteConnector(db_path=crm_db)


# ── load_entity ────────────────────────────────────────────────────────────────


class TestLoadEntity:
    def test_load_customers(self, connector):
        rows = list(connector.load_entity("Customer"))
        assert len(rows) == 2

    def test_load_contacts(self, connector):
        rows = list(connector.load_entity("Contact"))
        assert len(rows) == 1

    def test_customer_row_is_dict(self, connector):
        rows = list(connector.load_entity("Customer"))
        assert isinstance(rows[0], dict)

    def test_customer_fields_present(self, connector):
        rows = list(connector.load_entity("Customer"))
        assert "name" in rows[0]
        assert "customer_type" in rows[0]

    def test_unknown_entity_raises_value_error(self, connector):
        with pytest.raises(ValueError, match="Unknown entity type"):
            list(connector.load_entity("Invoice"))

    def test_load_state_province(self, connector):
        rows = list(connector.load_entity("StateProvince"))
        assert len(rows) == 1
        assert rows[0]["code"] == "LOM"

    def test_load_country(self, connector):
        rows = list(connector.load_entity("Country"))
        assert len(rows) == 1
        assert rows[0]["code"] == "IT"


# ── describe ───────────────────────────────────────────────────────────────────


class TestDescribe:
    def test_source_name_is_crm(self, connector):
        assert connector.describe().name == "crm"

    def test_source_type_is_sqlite(self, connector):
        assert connector.describe().source_type == "sqlite"

    def test_all_known_tables_listed(self, connector):
        meta = connector.describe()
        assert set(meta.tables) == set(KNOWN_TABLES)

    def test_record_counts_non_negative(self, connector):
        counts = connector.describe().record_counts
        for table in KNOWN_TABLES:
            assert counts.get(table, 0) >= 0

    def test_account_count_correct(self, connector):
        counts = connector.describe().record_counts
        assert counts["account"] == 2

    def test_contact_count_correct(self, connector):
        counts = connector.describe().record_counts
        assert counts["contact"] == 1

    def test_loaded_at_set_after_connect(self, connector):
        connector.describe()
        assert connector._loaded_at is not None


# ── execute_query ──────────────────────────────────────────────────────────────


class TestExecuteQuery:
    def test_simple_select(self, connector):
        rows = connector.execute_query("SELECT * FROM account")
        assert len(rows) == 2

    def test_filtered_query(self, connector):
        rows = connector.execute_query(
            "SELECT * FROM account WHERE customer_type = ?", ("Company",)
        )
        assert len(rows) == 1
        assert rows[0]["name"] == "Acme Corp"

    def test_count_query(self, connector):
        rows = connector.execute_query("SELECT COUNT(*) as cnt FROM account")
        assert rows[0]["cnt"] == 2

    def test_returns_dicts(self, connector):
        rows = connector.execute_query("SELECT * FROM country")
        assert isinstance(rows[0], dict)


# ── lazy connection ────────────────────────────────────────────────────────────


class TestLazyConnection:
    def test_not_connected_before_first_query(self, crm_db):
        c = SQLiteConnector(crm_db)
        assert c._conn is None

    def test_connected_after_query(self, connector):
        connector.load_entity("Customer")
        assert connector._conn is not None

    def test_same_connection_reused(self, connector):
        connector.load_entity("Customer")
        first = connector._conn
        connector.load_entity("Contact")
        assert connector._conn is first


# ── ENTITY_TABLE_MAP ──────────────────────────────────────────────────────────


class TestEntityTableMap:
    def test_all_expected_entities_mapped(self):
        for entity in ("Customer", "Contact", "Address", "StateProvince", "Country"):
            assert entity in ENTITY_TABLE_MAP

    def test_all_mapped_tables_in_known_tables(self):
        for table in ENTITY_TABLE_MAP.values():
            assert table in KNOWN_TABLES
