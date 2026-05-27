"""SQLiteConnector — wraps the CRM clienthub.db SQLite database."""
from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Iterable

from .base import BaseConnector, SourceMeta

ENTITY_TABLE_MAP = {
    "Customer": "account",
    "Contact": "contact",
    "Address": "address",
    "StateProvince": "state_province",
    "Country": "country",
}

KNOWN_TABLES = ["account", "contact", "address", "account_address", "state_province", "country"]


class SQLiteConnector(BaseConnector):
    """Reads the CRM SQLite database (clienthub.db)."""

    def __init__(self, db_path: Path | str) -> None:
        self._db_path = Path(db_path)
        self._conn: sqlite3.Connection | None = None
        self._loaded_at: datetime | None = None

    def _ensure_connected(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(str(self._db_path))
            self._conn.row_factory = sqlite3.Row
            self._loaded_at = datetime.utcnow()
        return self._conn

    def load_entity(self, entity_type: str) -> Iterable[dict]:
        table = ENTITY_TABLE_MAP.get(entity_type)
        if table is None:
            raise ValueError(
                f"Unknown entity type '{entity_type}'. Known: {list(ENTITY_TABLE_MAP)}"
            )
        conn = self._ensure_connected()
        rows = conn.execute(f"SELECT * FROM {table}").fetchall()
        return [dict(r) for r in rows]

    def describe(self) -> SourceMeta:
        conn = self._ensure_connected()
        counts: dict[str, int] = {}
        for table in KNOWN_TABLES:
            try:
                n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                counts[table] = n
            except Exception:
                counts[table] = 0
        return SourceMeta(
            name="crm",
            source_type="sqlite",
            tables=KNOWN_TABLES,
            record_counts=counts,
            loaded_at=self._loaded_at or datetime.utcnow(),
            notes="ClientHub CRM SQLite database. accountId < 0 indicates duplicate records.",
        )

    def execute_query(self, sql: str, params: tuple = ()) -> list[dict]:
        conn = self._ensure_connected()
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]
