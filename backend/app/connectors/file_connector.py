"""FileConnector — loads HR CSV and PIM JSON files.

HR CSV:  semicolon-separated, Italian dates (DD/MM/YYYY) in DataNascita, DataAssunzione.
PIM JSON: camelCase, US dates (MM/DD/YYYY) in sellStartDate, sellEndDate.

Dates are normalised to ISO 8601 at load time; the raw original string is
preserved in a `_raw_date_<field>` key within each row dict.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Iterable

import pandas as pd

from .base import BaseConnector, SourceMeta

logger = logging.getLogger(__name__)

# Which entity types this connector handles
ENTITY_TABLE_MAP: dict[str, str] = {
    "Employee": "hr",
    "Product": "pim",
}

# HR date columns (Italian DD/MM/YYYY)
_HR_DATE_COLS = ["DataNascita", "DataAssunzione"]

# PIM date columns (US MM/DD/YYYY)
_PIM_DATE_COLS = ["sellStartDate", "sellEndDate"]


def _parse_italian_date(value: str | None) -> str | None:
    """Parse DD/MM/YYYY → ISO 8601 YYYY-MM-DD.  Returns None if blank/invalid."""
    if not value or pd.isna(value):
        return None
    try:
        return datetime.strptime(str(value).strip(), "%d/%m/%Y").strftime("%Y-%m-%d")
    except ValueError:
        logger.warning("Could not parse Italian date: %r", value)
        return None


def _parse_us_date(value: str | None) -> str | None:
    """Parse MM/DD/YYYY → ISO 8601 YYYY-MM-DD.  Returns None if blank/invalid."""
    if not value or pd.isna(value):
        return None
    try:
        return datetime.strptime(str(value).strip(), "%m/%d/%Y").strftime("%Y-%m-%d")
    except ValueError:
        logger.warning("Could not parse US date: %r", value)
        return None


def _load_hr(csv_path: Path) -> list[dict]:
    """Load HR CSV and normalise Italian dates."""
    df = pd.read_csv(csv_path, sep=";", dtype=str)
    rows: list[dict] = []
    for _, row in df.iterrows():
        rec: dict = row.to_dict()
        for col in _HR_DATE_COLS:
            if col in rec:
                raw = rec[col]
                rec[f"_raw_date_{col}"] = raw
                rec[col] = _parse_italian_date(raw)
        rows.append(rec)
    logger.info("HR loaded: %d rows from %s", len(rows), csv_path)
    return rows


def _load_pim(json_path: Path) -> list[dict]:
    """Load PIM JSON and normalise US dates."""
    data = json.loads(json_path.read_text(encoding="utf-8"))
    products = data.get("products", [])
    rows: list[dict] = []
    for p in products:
        rec = dict(p)
        for col in _PIM_DATE_COLS:
            if col in rec:
                raw = rec[col]
                rec[f"_raw_date_{col}"] = raw
                rec[col] = _parse_us_date(raw)
        rows.append(rec)
    logger.info("PIM loaded: %d products from %s", len(rows), json_path)
    return rows


class FileConnector(BaseConnector):
    """Connector for HR CSV and PIM JSON flat files.

    Parameters
    ----------
    hr_csv_path:
        Path to ``dipendenti_hr.csv`` (semicolon-separated, Italian dates).
    pim_json_path:
        Path to ``product_catalog_pim.json`` (camelCase, US dates).
    """

    def __init__(self, hr_csv_path: Path | str, pim_json_path: Path | str) -> None:
        self._hr_path = Path(hr_csv_path)
        self._pim_path = Path(pim_json_path)
        self._hr_rows: list[dict] | None = None
        self._pim_rows: list[dict] | None = None
        self._loaded_at: datetime | None = None

    # ── lazy loaders ──────────────────────────────────────────────────────────

    def _ensure_hr(self) -> list[dict]:
        if self._hr_rows is None:
            self._hr_rows = _load_hr(self._hr_path)
            self._loaded_at = datetime.utcnow()
        return self._hr_rows

    def _ensure_pim(self) -> list[dict]:
        if self._pim_rows is None:
            self._pim_rows = _load_pim(self._pim_path)
            self._loaded_at = datetime.utcnow()
        return self._pim_rows

    # ── BaseConnector interface ───────────────────────────────────────────────

    def load_entity(self, entity_type: str) -> Iterable[dict]:
        """Yield rows for *entity_type*.  Accepts 'Employee' or 'Product'."""
        if entity_type == "Employee":
            return list(self._ensure_hr())
        if entity_type == "Product":
            return list(self._ensure_pim())
        raise ValueError(
            f"Unknown entity type '{entity_type}'. Known: {list(ENTITY_TABLE_MAP)}"
        )

    def describe(self) -> SourceMeta:
        hr = self._ensure_hr()
        pim = self._ensure_pim()
        return SourceMeta(
            name="hr_pim",
            source_type="file",
            tables=["dipendenti_hr", "product_catalog_pim"],
            record_counts={
                "dipendenti_hr": len(hr),
                "product_catalog_pim": len(pim),
            },
            loaded_at=self._loaded_at or datetime.utcnow(),
            notes=(
                "HR CSV (;-sep, Italian dates DD/MM/YYYY). "
                "PIM JSON (camelCase, US dates MM/DD/YYYY). "
                "Dates normalised to ISO 8601 at load time."
            ),
        )

    def execute_query(self, sql: str, params: tuple = ()) -> list[dict]:
        """Execute a pandas-style SQL query using in-memory DuckDB.

        Exposes two virtual tables: ``dipendenti_hr`` and ``product_catalog_pim``.
        """
        import duckdb

        hr = self._ensure_hr()
        pim = self._ensure_pim()

        # Build DataFrames so DuckDB can query them by name
        import pandas as pd  # already imported at module level but re-import is safe

        dipendenti_hr = pd.DataFrame(hr)  # noqa: F841  (used by DuckDB via locals)
        product_catalog_pim = pd.DataFrame(pim)  # noqa: F841

        con = duckdb.connect(database=":memory:")
        con.register("dipendenti_hr", dipendenti_hr)
        con.register("product_catalog_pim", product_catalog_pim)
        rel = con.execute(sql, list(params) if params else [])
        columns = [desc[0] for desc in rel.description]
        return [dict(zip(columns, row)) for row in rel.fetchall()]
