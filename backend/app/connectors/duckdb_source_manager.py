"""
DuckDBSourceManager — scalable, registry-driven data layer.

Architecture
============

All configured sources are stored in a SourceRegistry (SQLite).
Runtime mode is controlled by FRA_STORAGE_MODE:
- nostore (default): no local datalake persistence; ephemeral in-memory DuckDB
- snapshot: persistent DuckDB snapshot file reused across restarts

Adding a new source
-------------------
POST /api/sources  →  SourceRegistry.upsert()  →  POST /api/sources/{id}/sync
The sync call triggers a full snapshot rebuild with the new source included.

Supported connector_types
--------------------------
  erp_sqldump   — PostgreSQL dump loaded via SQLite (default ERP source)
  crm_sqlite    — SQLite database (default CRM source)
  hr_csv        — semicolon-delimited CSV (default HR source)
  pim_json      — JSON with products array (default PIM source)
  csv           — any CSV file (comma or semicolon)
  json          — any JSON file (top-level array or {records: [...]} object)
  excel         — .xlsx / .xls via pandas
  sqlite        — any SQLite database (all tables or filtered list)
  postgresql    — PostgreSQL via psycopg2 + pandas (table list required)
  <saas>        — registered but not yet synced (status stays 'pending')
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

import duckdb
import pandas as pd

from .base import SourceMeta
from .source_registry import (
    SourceConfig,
    SourceRegistry,
    get_source_registry,
    IMPLEMENTED_CONNECTOR_TYPES,
)

logger = logging.getLogger(__name__)

_SCHEMA_VERSION = "3"  # bumped: registry-driven schema

# Paths at or under these roots are never opened as data sources (defence-in-depth).
_BLOCKED_PATH_ROOTS = ("/etc", "/proc", "/sys", "/dev", "/run", "/boot")


def _safe_data_path(raw: str) -> Path:
    """Resolve and validate a file path supplied by an admin-configured source.

    Raises ValueError if the resolved path sits under a blocked system prefix,
    preventing accidental or malicious reads of sensitive OS files.
    """
    resolved = Path(raw).resolve()
    resolved_str = str(resolved)
    for root in _BLOCKED_PATH_ROOTS:
        # Block the root directory itself and anything beneath it.
        if resolved_str == root or resolved_str.startswith(root + "/"):
            raise ValueError(
                f"Data source path '{raw}' resolves to a restricted location"
            )
    return resolved


_MANAGER: "DuckDBSourceManager | None" = None
_MANAGER_LOCK = threading.RLock()

# File extensions that can be auto-discovered and registered as sources.
_DISCOVERABLE_EXTENSIONS: dict[str, str] = {
    ".csv": "csv",
    ".json": "json",
    ".xlsx": "excel",
    ".xls": "excel",
    ".parquet": "parquet",
    ".db": "sqlite",
    ".sqlite": "sqlite",
    ".sqlite3": "sqlite",
}

_ERP_TABLES = [
    "sales_order_header",
    "sales_order_line",
    "salesperson",
    "territory",
    "offer",
]
_CRM_TABLES = ["account", "contact", "address", "account_address", "state_province"]


# ── Singleton access ──────────────────────────────────────────────────────────


def get_source_manager(
    scenario_path: Path,
    db_path: Path | None = None,
) -> "DuckDBSourceManager":
    """Return the process-wide singleton DuckDBSourceManager."""
    global _MANAGER
    if _MANAGER is not None:
        return _MANAGER
    with _MANAGER_LOCK:
        if _MANAGER is None:
            effective_db = db_path or (
                Path(__file__).parent.parent.parent / "data" / "fra_unified.duckdb"
            )
            effective_db.parent.mkdir(parents=True, exist_ok=True)
            registry = get_source_registry()
            _MANAGER = DuckDBSourceManager(scenario_path, effective_db, registry)
    return _MANAGER


# ── Main class ────────────────────────────────────────────────────────────────


class DuckDBSourceManager:
    """
    Registry-driven connector for all data sources.

    On init it seeds the registry with the 4 default scenario sources (if
    the registry is empty), then builds or opens the DuckDB snapshot.
    """

    def __init__(
        self,
        scenario_path: Path,
        db_path: Path,
        registry: SourceRegistry,
    ) -> None:
        self._scenario_path = Path(scenario_path)
        self._db_path = Path(db_path)
        self._registry = registry
        self._ready = False
        self._init_lock = threading.RLock()
        self._row_counts: dict[str, int] = {}
        self._built_at: datetime | None = None
        mode = os.getenv("FRA_STORAGE_MODE", "snapshot").strip().lower()
        self._storage_mode = mode if mode in {"nostore", "snapshot"} else "nostore"

        self._seed_defaults()

    # ── Public API ─────────────────────────────────────────────────────────────

    def get_connection(self) -> duckdb.DuckDBPyConnection:
        """Return a DuckDB connection for current storage mode."""
        self._ensure_ready()
        if self._storage_mode == "nostore":
            conn = duckdb.connect(":memory:")
            self._populate_connection(conn)
            return conn
        return duckdb.connect(str(self._db_path), read_only=True)

    def execute(self, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        """Execute a SELECT and return up to 100 rows (for frontend queries)."""
        conn = self.get_connection()
        try:
            if params:
                df = conn.execute(sql, params).df().head(100)
            else:
                df = conn.execute(sql).df().head(100)
            return df.where(df.notna(), other=None).to_dict(orient="records")
        finally:
            conn.close()

    def execute_all(
        self, sql: str, params: tuple[Any, ...] = ()
    ) -> list[dict[str, Any]]:
        """Execute a SELECT and return ALL rows (for KG/catalog bulk loads)."""
        conn = self.get_connection()
        try:
            if params:
                df = conn.execute(sql, params).df()
            else:
                df = conn.execute(sql).df()
            return df.where(df.notna(), other=None).to_dict(orient="records")
        finally:
            conn.close()

    def rebuild(self) -> dict[str, int]:
        """Force full re-ingest of all active sources."""
        with self._init_lock:
            if self._storage_mode == "snapshot" and self._db_path.exists():
                self._db_path.unlink()
                logger.info("Removed stale snapshot: %s", self._db_path)
            self._ready = False
            self._row_counts = {}
            self._built_at = None
            self._ensure_ready()
        return dict(self._row_counts)

    def ingest_one(self, source_id: str) -> dict[str, int]:
        """Re-ingest a single source then rebuild the full snapshot."""
        cfg = self._registry.get(source_id)
        if cfg is None:
            raise KeyError(f"Source '{source_id}' not found in registry")
        self._registry.patch(source_id, status="syncing", error_msg=None)
        return self.rebuild()

    def describe(self) -> SourceMeta:
        self._ensure_ready()
        return SourceMeta(
            name="unified_duckdb",
            source_type="duckdb_snapshot"
            if self._storage_mode == "snapshot"
            else "duckdb_nostore_ephemeral",
            tables=list(self._row_counts.keys()),
            record_counts=self._row_counts,
            loaded_at=self._built_at or datetime.utcnow(),
            notes=(
                f"DuckDB unified store | mode={self._storage_mode} | schema_version={_SCHEMA_VERSION} | "
                f"sources={len(self._registry.list())} | path={self._db_path}"
            ),
        )

    def get_schema_info(self) -> dict[str, dict]:
        """Discover schema for every table in the current DuckDB snapshot.

        Returns {table_name: {columns: [{name, type}], row_count: int, sample: [dict]}}
        Used to provide grounded schema context to the LLM for dynamic SQL generation.
        """
        self._ensure_ready()
        conn = self.get_connection()
        try:
            tables = [r[0] for r in conn.execute("SHOW TABLES").fetchall()]
            result: dict[str, dict] = {}
            for table in tables:
                safe = table.replace('"', '""')
                try:
                    cols = conn.execute(f'DESCRIBE "{safe}"').fetchall()
                    _row = conn.execute(
                        f'SELECT COUNT(*) AS n FROM "{safe}"'
                    ).fetchone()
                    count = int(_row[0]) if _row else 0
                    sample_df = conn.execute(f'SELECT * FROM "{safe}" LIMIT 5').df()
                    sample = sample_df.where(sample_df.notna(), other=None).to_dict(
                        orient="records"
                    )
                    result[table] = {
                        "columns": [{"name": c[0], "type": c[1]} for c in cols],
                        "row_count": count,
                        "sample": sample,
                    }
                except Exception as exc:
                    logger.warning(
                        "get_schema_info: skipping table '%s': %s", table, exc
                    )
            return result
        finally:
            conn.close()

    @property
    def registry(self) -> SourceRegistry:
        return self._registry

    @property
    def row_counts(self) -> dict[str, int]:
        self._ensure_ready()
        return dict(self._row_counts)

    @property
    def built_at(self) -> datetime | None:
        return self._built_at

    # ── Defaults seeding ───────────────────────────────────────────────────────

    def _seed_defaults(self) -> None:
        """Seed the 4 default scenario sources if the registry is empty.

        After seeding (or if defaults already exist), scan the scenario path
        for any additional data files not yet in the registry and register them
        automatically so real sources require no manual configuration.
        """
        if self._registry.count() == 0:
            sp = self._scenario_path
            defaults = [
                SourceConfig(
                    id="erp",
                    connector_type="erp_sqldump",
                    label="ERP — OrionSales",
                    params={"path": str(sp / "erp_postgres" / "orion_sales_dump.sql")},
                    target_tables=_ERP_TABLES,
                    is_default=True,
                ),
                SourceConfig(
                    id="crm",
                    connector_type="crm_sqlite",
                    label="CRM — ClientHub",
                    params={"path": str(sp / "crm_sqlite" / "clienthub.db")},
                    target_tables=_CRM_TABLES,
                    is_default=True,
                ),
                SourceConfig(
                    id="hr",
                    connector_type="hr_csv",
                    label="HR — Employees",
                    params={
                        "path": str(sp / "hr_pim_files" / "dipendenti_hr.csv"),
                        "delimiter": ";",
                    },
                    target_tables=["hr_employees"],
                    is_default=True,
                ),
                SourceConfig(
                    id="pim",
                    connector_type="pim_json",
                    label="PIM — Product Catalog",
                    params={
                        "path": str(sp / "hr_pim_files" / "product_catalog_pim.json")
                    },
                    target_tables=["pim_products"],
                    is_default=True,
                ),
            ]
            for cfg in defaults:
                self._registry.upsert(cfg)
            logger.info("Seeded %d default sources into registry", len(defaults))

        # Auto-discover any additional files not yet registered
        discovered = self._auto_discover_files(self._scenario_path)
        if discovered:
            logger.info("Auto-discovered %d new data file(s)", discovered)

    # ── Initialisation ─────────────────────────────────────────────────────────

    def _ensure_ready(self) -> None:
        if self._ready:
            return
        with self._init_lock:
            if self._ready:
                return
            if self._storage_mode == "nostore":
                probe = duckdb.connect(":memory:")
                try:
                    self._populate_connection(probe)
                finally:
                    probe.close()
                self._ready = True
                return
            if self._db_path.exists():
                if self._try_load_snapshot():
                    self._ready = True
                    return
                self._db_path.unlink()
            self._build_snapshot()
            self._ready = True

    def _try_load_snapshot(self) -> bool:
        try:
            conn = duckdb.connect(str(self._db_path), read_only=True)
            try:
                meta_rows = conn.execute(
                    "SELECT key, value FROM _build_meta"
                ).fetchall()
            finally:
                conn.close()
        except Exception as exc:
            logger.warning("Cannot open snapshot %s: %s", self._db_path, exc)
            return False
        meta = {r[0]: r[1] for r in meta_rows}
        if meta.get("schema_version") != _SCHEMA_VERSION:
            logger.info(
                "Snapshot schema version mismatch (got %s, want %s) — rebuilding",
                meta.get("schema_version"),
                _SCHEMA_VERSION,
            )
            return False
        try:
            self._built_at = datetime.fromisoformat(
                meta.get("built_at", datetime.utcnow().isoformat())
            )
        except (ValueError, TypeError):
            logger.warning("Snapshot has malformed built_at metadata — rebuilding")
            return False
        try:
            self._row_counts = json.loads(meta.get("row_counts", "{}"))
        except json.JSONDecodeError:
            self._row_counts = {}
        logger.info(
            "Snapshot loaded: %s | built %s | %d total rows",
            self._db_path,
            self._built_at.isoformat(),
            sum(self._row_counts.values()),
        )
        return True

    # ── Snapshot build ─────────────────────────────────────────────────────────

    def _build_snapshot(self) -> None:
        logger.info("Building DuckDB snapshot at %s …", self._db_path)
        conn = duckdb.connect(str(self._db_path))
        try:
            self._populate_connection(conn)
            self._write_meta(conn)
            conn.execute("CHECKPOINT")
            logger.info(
                "Snapshot built: %d tables, %d total rows",
                len(self._row_counts),
                sum(self._row_counts.values()),
            )
        except Exception:
            conn.close()
            if self._db_path.exists():
                self._db_path.unlink()
            raise
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def _populate_connection(self, conn: duckdb.DuckDBPyConnection) -> None:
        self._row_counts = {}
        for cfg in self._registry.list():
            try:
                self._ingest_source(conn, cfg)
                now = datetime.utcnow().isoformat()
                self._registry.patch(
                    cfg.id,
                    status="active",
                    error_msg=None,
                    last_sync_at=now,
                    row_count=sum(
                        v
                        for k, v in self._row_counts.items()
                        if k.startswith(f"{cfg.id}.")
                    ),
                )
            except Exception as exc:
                logger.error("Failed to ingest source '%s': %s", cfg.id, exc)
                self._registry.patch(cfg.id, status="error", error_msg=str(exc))
        self._built_at = datetime.utcnow()

    def _write_meta(self, conn: duckdb.DuckDBPyConnection) -> None:
        self._built_at = datetime.utcnow()
        conn.execute(
            "CREATE TABLE IF NOT EXISTS _build_meta (key TEXT PRIMARY KEY, value TEXT)"
        )
        conn.execute("DELETE FROM _build_meta")
        conn.executemany(
            "INSERT INTO _build_meta VALUES (?, ?)",
            [
                ("built_at", self._built_at.isoformat()),
                ("row_counts", json.dumps(self._row_counts)),
                ("schema_version", _SCHEMA_VERSION),
            ],
        )

    # ── Source dispatcher ──────────────────────────────────────────────────────

    def _ingest_source(
        self, conn: duckdb.DuckDBPyConnection, cfg: SourceConfig
    ) -> None:
        ctype = cfg.connector_type
        if ctype == "erp_sqldump":
            self._ingest_erp_sqldump(conn, cfg)
        elif ctype == "crm_sqlite":
            self._ingest_crm_sqlite(conn, cfg)
        elif ctype == "hr_csv":
            self._ingest_hr_csv(conn, cfg)
        elif ctype == "pim_json":
            self._ingest_pim_json(conn, cfg)
        elif ctype == "csv":
            self._ingest_csv(conn, cfg)
        elif ctype == "json":
            self._ingest_json_file(conn, cfg)
        elif ctype == "excel":
            self._ingest_excel(conn, cfg)
        elif ctype == "sqlite":
            self._ingest_sqlite_generic(conn, cfg)
        elif ctype == "postgresql":
            self._ingest_postgresql(conn, cfg)
        elif ctype == "parquet":
            self._ingest_parquet(conn, cfg)
        elif ctype == "context_doc":
            self._ingest_context_doc(conn, cfg)
        elif ctype not in IMPLEMENTED_CONNECTOR_TYPES:
            logger.info(
                "Source '%s' connector_type='%s' not yet implemented — skipping",
                cfg.id,
                ctype,
            )
        else:
            raise NotImplementedError(f"Connector type '{ctype}' has no ingester")

    # ── Per-type ingesters ─────────────────────────────────────────────────────

    def _ingest_erp_sqldump(
        self, conn: duckdb.DuckDBPyConnection, cfg: SourceConfig
    ) -> None:
        dump_path = _safe_data_path(cfg.params.get("path", ""))
        if not dump_path.exists():
            logger.warning("ERP dump not found: %s", dump_path)
            return
        from .postgres_connector import _load_sql_dump_to_sqlite

        sqlite_conn = _load_sql_dump_to_sqlite(dump_path)
        try:
            for table in _ERP_TABLES:
                try:
                    rows = sqlite_conn.execute(f"SELECT * FROM {table}").fetchall()
                    df = pd.DataFrame([dict(r) for r in rows])
                    conn.execute(
                        f"CREATE TABLE IF NOT EXISTS {table} AS SELECT * FROM df"
                    )
                    self._row_counts[f"{cfg.id}.{table}"] = len(df)
                    logger.info("ERP  %-25s %7d rows", table, len(df))
                except Exception as exc:
                    logger.warning("Could not ingest ERP.%s: %s", table, exc)
        finally:
            sqlite_conn.close()

    def _ingest_crm_sqlite(
        self, conn: duckdb.DuckDBPyConnection, cfg: SourceConfig
    ) -> None:
        import sqlite3 as _sqlite3

        crm_path = _safe_data_path(cfg.params.get("path", ""))
        if not crm_path.exists():
            logger.warning("CRM SQLite not found: %s", crm_path)
            return
        sqlite_conn = _sqlite3.connect(str(crm_path))
        sqlite_conn.row_factory = _sqlite3.Row
        try:
            for table in _CRM_TABLES:
                try:
                    rows = sqlite_conn.execute(f"SELECT * FROM {table}").fetchall()
                    df = pd.DataFrame([dict(r) for r in rows])
                    conn.execute(
                        f"CREATE TABLE IF NOT EXISTS {table} AS SELECT * FROM df"
                    )
                    self._row_counts[f"{cfg.id}.{table}"] = len(df)
                    logger.info("CRM  %-25s %7d rows", table, len(df))
                except Exception as exc:
                    logger.warning("Could not ingest CRM.%s: %s", table, exc)
        finally:
            sqlite_conn.close()

    def _ingest_hr_csv(
        self, conn: duckdb.DuckDBPyConnection, cfg: SourceConfig
    ) -> None:
        hr_path = _safe_data_path(cfg.params.get("path", ""))
        if not hr_path.exists():
            logger.warning("HR CSV not found: %s", hr_path)
            return
        from .file_connector import _load_hr

        rows = _load_hr(hr_path)
        df = pd.DataFrame(rows)
        conn.execute("CREATE TABLE IF NOT EXISTS hr_employees AS SELECT * FROM df")
        conn.execute(
            "CREATE OR REPLACE VIEW dipendenti_hr AS SELECT * FROM hr_employees"
        )
        self._row_counts[f"{cfg.id}.hr_employees"] = len(df)
        logger.info("HR   %-25s %7d rows", "hr_employees", len(df))

    def _ingest_pim_json(
        self, conn: duckdb.DuckDBPyConnection, cfg: SourceConfig
    ) -> None:
        pim_path = _safe_data_path(cfg.params.get("path", ""))
        if not pim_path.exists():
            logger.warning("PIM JSON not found: %s", pim_path)
            return
        from .file_connector import _load_pim

        rows = _load_pim(pim_path)
        df = pd.DataFrame(rows)
        conn.execute("CREATE TABLE IF NOT EXISTS pim_products AS SELECT * FROM df")
        conn.execute(
            "CREATE OR REPLACE VIEW product_catalog_pim AS SELECT * FROM pim_products"
        )
        self._row_counts[f"{cfg.id}.pim_products"] = len(df)
        logger.info("PIM  %-25s %7d rows", "pim_products", len(df))

    def _ingest_csv(self, conn: duckdb.DuckDBPyConnection, cfg: SourceConfig) -> None:
        import io

        # Support inline CSV (uploaded from browser) or file path
        _MAX_INLINE_BYTES = 5 * 1024 * 1024  # 5 MB guard against OOM
        inline = cfg.params.get("inline_csv")
        table = cfg.params.get("table_name") or "imported_data"
        if inline:
            if len(inline.encode("utf-8")) > _MAX_INLINE_BYTES:
                raise ValueError(f"Inline CSV exceeds 5 MB limit ({len(inline)} chars)")
            df = pd.read_csv(io.StringIO(inline), sep=",", low_memory=False)
        else:
            path = _safe_data_path(cfg.params.get("path", ""))
            if not path.exists():
                raise FileNotFoundError(f"CSV not found: {path}")
            table = table or path.stem.replace("-", "_").replace(" ", "_").lower()
            delimiter = cfg.params.get("delimiter", ",")
            df = pd.read_csv(
                str(path), sep=delimiter, encoding="utf-8", low_memory=False
            )
        conn.execute(f'CREATE TABLE IF NOT EXISTS "{table}" AS SELECT * FROM df')
        self._row_counts[f"{cfg.id}.{table}"] = len(df)
        logger.info("CSV  %-25s %7d rows", table, len(df))
        if table not in cfg.target_tables:
            cfg.target_tables.append(table)

    def _ingest_json_file(
        self, conn: duckdb.DuckDBPyConnection, cfg: SourceConfig
    ) -> None:
        path = _safe_data_path(cfg.params.get("path", ""))
        if not path.exists():
            raise FileNotFoundError(f"JSON not found: {path}")
        table = (
            cfg.params.get("table_name")
            or path.stem.replace("-", "_").replace(" ", "_").lower()
        )
        records_key = cfg.params.get("records_key")
        raw = json.loads(path.read_text(encoding="utf-8"))
        records = (
            raw if isinstance(raw, list) else raw.get(records_key or "records", raw)
        )
        if not isinstance(records, list):
            raise ValueError(
                "JSON must be a top-level array or contain a list under 'records_key'"
            )
        df = pd.DataFrame(records)
        conn.execute(f'CREATE TABLE IF NOT EXISTS "{table}" AS SELECT * FROM df')
        self._row_counts[f"{cfg.id}.{table}"] = len(df)
        logger.info("JSON %-25s %7d rows", table, len(df))
        if table not in cfg.target_tables:
            cfg.target_tables.append(table)

    def _ingest_excel(self, conn: duckdb.DuckDBPyConnection, cfg: SourceConfig) -> None:
        path = _safe_data_path(cfg.params.get("path", ""))
        if not path.exists():
            raise FileNotFoundError(f"Excel not found: {path}")
        sheet = cfg.params.get("sheet", 0)
        table = (
            cfg.params.get("table_name")
            or path.stem.replace("-", "_").replace(" ", "_").lower()
        )
        df = pd.read_excel(str(path), sheet_name=sheet)
        conn.execute(f'CREATE TABLE IF NOT EXISTS "{table}" AS SELECT * FROM df')
        self._row_counts[f"{cfg.id}.{table}"] = len(df)
        logger.info("XLS  %-25s %7d rows", table, len(df))
        if table not in cfg.target_tables:
            cfg.target_tables.append(table)

    def _ingest_sqlite_generic(
        self, conn: duckdb.DuckDBPyConnection, cfg: SourceConfig
    ) -> None:
        import sqlite3 as _sqlite3

        path = _safe_data_path(cfg.params.get("path", ""))
        if not path.exists():
            raise FileNotFoundError(f"SQLite not found: {path}")
        table_filter: list[str] | None = cfg.params.get("tables")
        src = _sqlite3.connect(str(path))
        src.row_factory = _sqlite3.Row
        try:
            tables = [
                r[0]
                for r in src.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                ).fetchall()
            ]
            if table_filter:
                tables = [t for t in tables if t in table_filter]
            for table in tables:
                safe_id = table.replace('"', '""')  # escape SQL identifier
                rows = src.execute(f'SELECT * FROM "{safe_id}"').fetchall()
                df = pd.DataFrame([dict(r) for r in rows])
                conn.execute(
                    f'CREATE TABLE IF NOT EXISTS "{safe_id}" AS SELECT * FROM df'
                )
                self._row_counts[f"{cfg.id}.{table}"] = len(df)
                logger.info("SDB  %-25s %7d rows", table, len(df))
                if table not in cfg.target_tables:
                    cfg.target_tables.append(table)
        finally:
            src.close()

    def _ingest_postgresql(
        self, conn: duckdb.DuckDBPyConnection, cfg: SourceConfig
    ) -> None:
        dsn = cfg.params.get("dsn", "")
        tables: list[str] = cfg.params.get("tables", [])
        schema: str = cfg.params.get("schema", "public")
        if not dsn:
            raise ValueError("PostgreSQL source requires 'dsn' param")
        if not tables:
            raise ValueError(
                "PostgreSQL source requires 'tables' param (list of table names)"
            )
        try:
            import psycopg2
            import psycopg2.extras

            pg_conn = psycopg2.connect(dsn, connect_timeout=10)
            try:
                cur = pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
                for table in tables:
                    cur.execute(f'SELECT * FROM "{schema}"."{table}" LIMIT 100000')
                    rows = cur.fetchall()
                    df = pd.DataFrame([dict(r) for r in rows])
                    conn.execute(
                        f'CREATE TABLE IF NOT EXISTS "{table}" AS SELECT * FROM df'
                    )
                    self._row_counts[f"{cfg.id}.{table}"] = len(df)
                    logger.info("PG   %-25s %7d rows", table, len(df))
                    if table not in cfg.target_tables:
                        cfg.target_tables.append(table)
            finally:
                pg_conn.close()
        except ImportError:
            # Fallback: try DuckDB postgres_scanner
            conn.execute("INSTALL postgres_scanner; LOAD postgres_scanner;")
            conn.execute(f"ATTACH '{dsn}' AS _pg_src (TYPE POSTGRES, READ_ONLY)")
            for table in tables:
                conn.execute(
                    f'CREATE TABLE IF NOT EXISTS "{table}" AS SELECT * FROM _pg_src."{schema}"."{table}"'
                )
                n = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
                self._row_counts[f"{cfg.id}.{table}"] = n
                logger.info("PG   %-25s %7d rows", table, n)
                if table not in cfg.target_tables:
                    cfg.target_tables.append(table)

    def _ingest_parquet(
        self, conn: duckdb.DuckDBPyConnection, cfg: SourceConfig
    ) -> None:
        path = _safe_data_path(cfg.params.get("path", ""))
        if not path.exists():
            raise FileNotFoundError(f"Parquet not found: {path}")
        table = (
            cfg.params.get("table_name")
            or path.stem.replace("-", "_").replace(" ", "_").lower()
        )
        safe_path = str(path).replace("'", "''")
        conn.execute(
            f'CREATE TABLE IF NOT EXISTS "{table}" AS '
            f"SELECT * FROM read_parquet('{safe_path}')"
        )
        n = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        self._row_counts[f"{cfg.id}.{table}"] = n
        logger.info("PQT  %-25s %7d rows", table, n)
        if table not in cfg.target_tables:
            cfg.target_tables.append(table)

    def _ingest_context_doc(
        self, conn: duckdb.DuckDBPyConnection, cfg: SourceConfig
    ) -> None:
        """Context documents are metadata-only — no DuckDB table is created."""
        logger.info("CTX  %-25s (context document, no DuckDB table)", cfg.label)

    # ── Auto-discovery ─────────────────────────────────────────────────────────

    def _auto_discover_files(self, directory: Path) -> int:
        """Scan *directory* recursively for supported data files and register new ones.

        Files whose resolved path is already referenced by an existing registry
        entry are skipped.  Returns the count of newly registered sources.
        """
        if not directory.exists() or not directory.is_dir():
            return 0

        # Collect all paths already referenced by the registry
        registered_paths: set[str] = set()
        for cfg in self._registry.list():
            raw = cfg.params.get("path")
            if raw:
                try:
                    registered_paths.add(str(Path(raw).resolve()))
                except Exception:
                    pass

        new_count = 0
        for file_path in sorted(directory.rglob("*")):
            if not file_path.is_file():
                continue
            ext = file_path.suffix.lower()
            connector_type = _DISCOVERABLE_EXTENSIONS.get(ext)
            if not connector_type:
                continue
            resolved = str(file_path.resolve())
            if resolved in registered_paths:
                continue  # already registered

            # Derive a stable, collision-free source ID from the relative path
            try:
                rel = file_path.relative_to(directory)
            except ValueError:
                rel = file_path
            base_id = f"auto_{rel.stem.replace('-', '_').replace(' ', '_').lower()}"
            source_id = base_id
            suffix = 0
            while self._registry.get(source_id) is not None:
                suffix += 1
                source_id = f"{base_id}_{suffix}"

            table_name = file_path.stem.replace("-", "_").replace(" ", "_").lower()
            new_cfg = SourceConfig(
                id=source_id,
                connector_type=connector_type,
                label=f"Auto-discovered: {file_path.name}",
                params={"path": str(file_path), "table_name": table_name},
                target_tables=[table_name],
                is_default=False,
            )
            self._registry.upsert(new_cfg)
            registered_paths.add(resolved)
            new_count += 1
            logger.info(
                "Auto-discovered source '%s' (%s): %s",
                source_id,
                connector_type,
                file_path.name,
            )

        return new_count

    # ── Adapter shims (BaseConnector-compatible) ───────────────────────────────
    # These expose load_entity() / execute_query() / describe() so KnowledgeGraph
    # and MetadataCatalog can read from the same DuckDB snapshot.


class _DuckDBConnectorAdapter:
    _SOURCE_NAME: str = ""
    _ENTITY_MAP: dict[str, str] = {}

    def __init__(self, mgr: "DuckDBSourceManager") -> None:
        self._mgr = mgr

    def load_entity(self, entity_type: str) -> list[dict[str, Any]]:
        table = self._ENTITY_MAP.get(entity_type)
        if not table:
            raise ValueError(f"{self._SOURCE_NAME}: unknown entity '{entity_type}'")
        return self._mgr.execute_all(f'SELECT * FROM "{table}"')

    def execute_query(
        self, sql: str, params: tuple[Any, ...] = ()
    ) -> list[dict[str, Any]]:
        return self._mgr.execute_all(sql, params)

    def describe(self) -> SourceMeta:
        unified = self._mgr.describe()
        tables = list(self._ENTITY_MAP.values())
        counts = {
            t: unified.record_counts.get(f"{self._SOURCE_NAME}.{t}", 0) for t in tables
        }
        return SourceMeta(
            name=self._SOURCE_NAME,
            source_type=unified.source_type,
            tables=tables,
            record_counts=counts,
            loaded_at=unified.loaded_at,
        )


class ERPDuckDBAdapter(_DuckDBConnectorAdapter):
    _SOURCE_NAME = "erp"
    _ENTITY_MAP = {
        "SalesOrder": "sales_order_header",
        "SalesOrderLine": "sales_order_line",
        "Salesperson": "salesperson",
        "Territory": "territory",
        "Offer": "offer",
    }


class CRMDuckDBAdapter(_DuckDBConnectorAdapter):
    _SOURCE_NAME = "crm"
    _ENTITY_MAP = {
        "Customer": "account",
        "Address": "address",
    }


class HRPIMDuckDBAdapter(_DuckDBConnectorAdapter):
    _SOURCE_NAME = "hr_pim"
    _ENTITY_MAP = {
        "Employee": "hr_employees",
        "Product": "pim_products",
    }


class GenericDuckDBAdapter:
    """Source-agnostic DuckDB adapter driven by a runtime entity→table mapping.

    Unlike the hardcoded ERP/CRM/HRPIM adapters, this class accepts any
    entity→table mapping at construction time, making it suitable for any source
    registered at runtime (CSV, SQLite, JSON, etc.).

    Usage:
        adapter = GenericDuckDBAdapter(
            mgr,
            entity_table_map={"Supplier": "suppliers", "Invoice": "invoices"},
            pk_map={"Supplier": "supplier_id", "Invoice": "invoice_id"},
            label="erp2",
        )
        rows = adapter.load_entity("Supplier")  # SELECT * FROM "suppliers"
    """

    def __init__(
        self,
        mgr: "DuckDBSourceManager",
        entity_table_map: dict[str, str],
        pk_map: dict[str, str] | None = None,
        label: str = "generic",
    ) -> None:
        self._mgr = mgr
        self._entity_table_map = dict(entity_table_map)
        self._pk_map = dict(pk_map or {})
        self._label = label

    def load_entity(self, entity_type: str) -> list[dict[str, Any]]:
        """Load all rows for *entity_type* from its mapped DuckDB table."""
        table = self._entity_table_map.get(entity_type)
        if not table:
            return []
        safe = table.replace('"', '""')
        try:
            return self._mgr.execute_all(f'SELECT * FROM "{safe}"')
        except Exception as exc:
            logger.warning(
                "GenericDuckDBAdapter.load_entity('%s' → table='%s') failed: %s",
                entity_type,
                table,
                exc,
            )
            return []

    def execute_query(
        self, sql: str, params: tuple[Any, ...] = ()
    ) -> list[dict[str, Any]]:
        """Execute a SQL statement against the unified DuckDB snapshot."""
        return self._mgr.execute(sql, params)

    def describe(self) -> SourceMeta:
        return SourceMeta(
            name=self._label,
            source_type="generic_duckdb",
            tables=list(self._entity_table_map.values()),
            record_counts={},
            loaded_at=self._mgr.built_at or datetime.utcnow(),
        )
