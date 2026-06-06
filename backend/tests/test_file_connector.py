"""Unit tests for connectors/file_connector.py.

Tests the pure date-parsing helpers and the FileConnector with synthetic
CSV/JSON files written to tmp_path — no real data files required.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.connectors.file_connector import (
    FileConnector,
    _parse_italian_date,
    _parse_us_date,
)


# ── Date parsing helpers ───────────────────────────────────────────────────────


class TestParseItalianDate:
    def test_valid_date(self):
        assert _parse_italian_date("25/12/1990") == "1990-12-25"

    def test_leading_zeros(self):
        assert _parse_italian_date("01/01/2000") == "2000-01-01"

    def test_none_returns_none(self):
        assert _parse_italian_date(None) is None

    def test_empty_string_returns_none(self):
        assert _parse_italian_date("") is None

    def test_invalid_format_returns_none(self):
        assert _parse_italian_date("2024-12-25") is None

    def test_us_format_rejected(self):
        # MM/DD/YYYY treated as DD/MM/YYYY — month 25 is invalid
        result = _parse_italian_date("12/25/2024")
        assert result is None

    def test_whitespace_stripped(self):
        assert _parse_italian_date("  15/06/2023  ") == "2023-06-15"


class TestParseUsDate:
    def test_valid_date(self):
        assert _parse_us_date("12/25/1990") == "1990-12-25"

    def test_leading_zeros(self):
        assert _parse_us_date("01/01/2000") == "2000-01-01"

    def test_none_returns_none(self):
        assert _parse_us_date(None) is None

    def test_empty_string_returns_none(self):
        assert _parse_us_date("") is None

    def test_invalid_format_returns_none(self):
        assert _parse_us_date("2024-12-25") is None

    def test_italian_format_rejected(self):
        # DD/MM/YYYY treated as MM/DD/YYYY — day 25 becomes month 25, invalid
        result = _parse_us_date("25/12/2024")
        assert result is None

    def test_whitespace_stripped(self):
        assert _parse_us_date("  06/15/2023  ") == "2023-06-15"


# ── FileConnector fixtures ────────────────────────────────────────────────────


HR_CSV = """\
NomeCompleto;Email;Reparto;DataNascita;DataAssunzione;Titolo
Mario Rossi;mario@example.com;IT;15/03/1985;01/09/2010;Software Engineer
Giulia Bianchi;giulia@example.com;HR;22/07/1990;15/02/2015;HR Manager
"""

PIM_JSON = json.dumps(
    {
        "products": [
            {
                "productID": 1,
                "name": "Widget A",
                "category": "Widgets",
                "sellStartDate": "01/15/2020",
                "sellEndDate": "12/31/2025",
                "listPrice": 9.99,
            },
            {
                "productID": 2,
                "name": "Gadget B",
                "category": "Gadgets",
                "sellStartDate": "03/01/2021",
                "sellEndDate": None,
                "listPrice": 49.99,
            },
        ]
    }
)


@pytest.fixture()
def connector(tmp_path) -> FileConnector:
    hr_path = tmp_path / "dipendenti.csv"
    pim_path = tmp_path / "products.json"
    hr_path.write_text(HR_CSV, encoding="utf-8")
    pim_path.write_text(PIM_JSON, encoding="utf-8")
    return FileConnector(hr_csv_path=hr_path, pim_json_path=pim_path)


# ── load_entity ────────────────────────────────────────────────────────────────


class TestLoadEntity:
    def test_load_employees(self, connector):
        rows = list(connector.load_entity("Employee"))
        assert len(rows) == 2

    def test_load_products(self, connector):
        rows = list(connector.load_entity("Product"))
        assert len(rows) == 2

    def test_employee_fields_present(self, connector):
        rows = list(connector.load_entity("Employee"))
        assert "NomeCompleto" in rows[0]
        assert "Reparto" in rows[0]

    def test_product_fields_present(self, connector):
        rows = list(connector.load_entity("Product"))
        assert "productID" in rows[0]
        assert "name" in rows[0]

    def test_unknown_entity_raises_value_error(self, connector):
        with pytest.raises(ValueError, match="Unknown entity type"):
            list(connector.load_entity("Invoice"))

    def test_hr_dates_normalised_to_iso(self, connector):
        rows = list(connector.load_entity("Employee"))
        assert rows[0]["DataNascita"] == "1985-03-15"
        assert rows[0]["DataAssunzione"] == "2010-09-01"

    def test_hr_raw_dates_preserved(self, connector):
        rows = list(connector.load_entity("Employee"))
        assert rows[0]["_raw_date_DataNascita"] == "15/03/1985"
        assert rows[0]["_raw_date_DataAssunzione"] == "01/09/2010"

    def test_pim_dates_normalised_to_iso(self, connector):
        rows = list(connector.load_entity("Product"))
        assert rows[0]["sellStartDate"] == "2020-01-15"
        assert rows[0]["sellEndDate"] == "2025-12-31"

    def test_pim_raw_dates_preserved(self, connector):
        rows = list(connector.load_entity("Product"))
        assert rows[0]["_raw_date_sellStartDate"] == "01/15/2020"

    def test_pim_none_date_produces_none(self, connector):
        rows = list(connector.load_entity("Product"))
        assert rows[1]["sellEndDate"] is None


# ── describe ───────────────────────────────────────────────────────────────────


class TestDescribe:
    def test_source_name(self, connector):
        meta = connector.describe()
        assert meta.name == "hr_pim"

    def test_source_type(self, connector):
        meta = connector.describe()
        assert meta.source_type == "file"

    def test_tables_listed(self, connector):
        meta = connector.describe()
        assert "dipendenti_hr" in meta.tables
        assert "product_catalog_pim" in meta.tables

    def test_record_counts(self, connector):
        meta = connector.describe()
        assert meta.record_counts["dipendenti_hr"] == 2
        assert meta.record_counts["product_catalog_pim"] == 2

    def test_loaded_at_set(self, connector):
        meta = connector.describe()
        assert meta.loaded_at is not None


# ── lazy loading ───────────────────────────────────────────────────────────────


class TestLazyLoading:
    def test_hr_loaded_once(self, connector):
        connector.load_entity("Employee")
        first_ref = connector._hr_rows
        connector.load_entity("Employee")
        assert connector._hr_rows is first_ref  # same object, not reloaded

    def test_pim_loaded_once(self, connector):
        connector.load_entity("Product")
        first_ref = connector._pim_rows
        connector.load_entity("Product")
        assert connector._pim_rows is first_ref
