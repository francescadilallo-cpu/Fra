"""SourceRegistry — persistent catalog of all configured data sources.

Each record stores the connector type, connection params, target DuckDB table
names, last sync status and row counts. Backed by a SQLite file in backend/data/.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

_REGISTRY: "SourceRegistry | None" = None
_REGISTRY_LOCK = threading.RLock()


def get_source_registry(db_path: Path | None = None) -> "SourceRegistry":
    """Return the process-wide singleton SourceRegistry."""
    global _REGISTRY
    if _REGISTRY is not None:
        return _REGISTRY
    with _REGISTRY_LOCK:
        if _REGISTRY is None:
            effective = db_path or (
                Path(__file__).parent.parent.parent / "data" / "source_registry.db"
            )
            _REGISTRY = SourceRegistry(effective)
    return _REGISTRY


@dataclass
class SourceConfig:
    id: str
    connector_type: str  # erp_sqldump | crm_sqlite | hr_csv | pim_json |
    # csv | json | excel | sqlite | postgresql | mysql |
    # shopify | stripe | salesforce | hubspot | ...
    label: str
    params: dict = field(default_factory=dict)
    target_tables: list[str] = field(default_factory=list)
    row_count: int = 0
    status: str = "pending"  # pending | active | error | syncing
    error_msg: str | None = None
    connected_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    last_sync_at: str | None = None
    is_default: bool = False  # default sources cannot be removed

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        return d


# Connector types that have a real backend ingester
IMPLEMENTED_CONNECTOR_TYPES = {
    "erp_sqldump",
    "crm_sqlite",
    "hr_csv",
    "pim_json",
    "csv",
    "json",
    "excel",
    "sqlite",
    "postgresql",
}

# SaaS connectors: registered in registry but ingestion not yet implemented
SAAS_CONNECTOR_TYPES = {
    "shopify",
    "woocommerce",
    "magento",
    "prestashop",
    "stripe",
    "satispay",
    "nexi",
    "salesforce",
    "hubspot",
    "teamsystem",
    "zucchetti",
    "sap_b1",
    "odoo",
    "fatture_in_cloud",
    "aruba_fe",
    "danea_easyfatt",
    "google_sheets",
    "airtable",
    "brt",
    "gls_italy",
    "sdi",
    "agenzia_entrate",
    "inps",
    "mysql",
}


class SourceRegistry:
    """Thread-safe SQLite-backed catalog of configured data sources."""

    def __init__(self, db_path: Path) -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._init_db()

    # ── Schema ─────────────────────────────────────────────────────────────────

    def _init_db(self) -> None:
        with self._lock:
            conn = self._open()
            try:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS sources (
                        id TEXT PRIMARY KEY,
                        connector_type TEXT NOT NULL,
                        label TEXT NOT NULL,
                        params_json TEXT DEFAULT '{}',
                        target_tables_json TEXT DEFAULT '[]',
                        row_count INTEGER DEFAULT 0,
                        status TEXT DEFAULT 'pending',
                        error_msg TEXT,
                        connected_at TEXT,
                        last_sync_at TEXT,
                        is_default INTEGER DEFAULT 0
                    )
                """)
                conn.commit()
            finally:
                conn.close()

    def _open(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    # ── Public API ─────────────────────────────────────────────────────────────

    def count(self) -> int:
        with self._lock:
            conn = self._open()
            try:
                return conn.execute("SELECT COUNT(*) FROM sources").fetchone()[0]
            finally:
                conn.close()

    def list(self) -> list[SourceConfig]:
        with self._lock:
            conn = self._open()
            try:
                rows = conn.execute(
                    "SELECT * FROM sources ORDER BY is_default DESC, connected_at ASC"
                ).fetchall()
                return [self._from_row(r) for r in rows]
            finally:
                conn.close()

    def get(self, source_id: str) -> SourceConfig | None:
        with self._lock:
            conn = self._open()
            try:
                row = conn.execute(
                    "SELECT * FROM sources WHERE id = ?", (source_id,)
                ).fetchone()
                return self._from_row(row) if row else None
            finally:
                conn.close()

    def upsert(self, cfg: SourceConfig) -> None:
        with self._lock:
            conn = self._open()
            try:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO sources
                    (id, connector_type, label, params_json, target_tables_json,
                     row_count, status, error_msg, connected_at, last_sync_at, is_default)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        cfg.id,
                        cfg.connector_type,
                        cfg.label,
                        json.dumps(cfg.params),
                        json.dumps(cfg.target_tables),
                        cfg.row_count,
                        cfg.status,
                        cfg.error_msg,
                        cfg.connected_at,
                        cfg.last_sync_at,
                        int(cfg.is_default),
                    ),
                )
                conn.commit()
            finally:
                conn.close()

    def patch(self, source_id: str, **kwargs) -> SourceConfig:
        cfg = self.get(source_id)
        if cfg is None:
            raise KeyError(f"Source '{source_id}' not found")
        for k, v in kwargs.items():
            if hasattr(cfg, k):
                setattr(cfg, k, v)
        self.upsert(cfg)
        return cfg

    def remove(self, source_id: str) -> None:
        cfg = self.get(source_id)
        if cfg is None:
            raise KeyError(f"Source '{source_id}' not found")
        if cfg.is_default:
            raise ValueError(f"Cannot remove default source '{source_id}'")
        with self._lock:
            conn = self._open()
            try:
                conn.execute("DELETE FROM sources WHERE id = ?", (source_id,))
                conn.commit()
            finally:
                conn.close()

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _from_row(self, row: sqlite3.Row) -> SourceConfig:
        return SourceConfig(
            id=row["id"],
            connector_type=row["connector_type"],
            label=row["label"],
            params=json.loads(row["params_json"] or "{}"),
            target_tables=json.loads(row["target_tables_json"] or "[]"),
            row_count=row["row_count"] or 0,
            status=row["status"] or "pending",
            error_msg=row["error_msg"],
            connected_at=row["connected_at"] or "",
            last_sync_at=row["last_sync_at"],
            is_default=bool(row["is_default"]),
        )
