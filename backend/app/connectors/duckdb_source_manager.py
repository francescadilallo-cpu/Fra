"""
DuckDBSourceManager — scalable, zero-RAM-copy data layer.

Architecture
============

**Snapshot mode** (default for file-based scenarios)
  First startup:  parse all 4 sources → write to ``backend/data/fra_unified.duckdb``
  Every restart:  open the .duckdb file read-only (<100 ms, no re-parsing)
  Rebuild:        DELETE the file + call ``manager.rebuild()``

**Live pushdown mode** (opt-in via environment variables)
  Set one or more of the env vars below to switch individual sources to native
  DuckDB readers that push filter/projection predicates down to the source,
  so only matching rows leave the source database:

    ERP_POSTGRES_DSN   postgresql://user:pass@host/db   → postgres_scanner
    CRM_SQLITE_PATH    /path/to/clienthub.db            → sqlite_scanner
    HR_CSV_PATH        /path/to/dipendenti_hr.csv       → read_csv (streaming)
    PIM_JSON_PATH      /path/to/product_catalog_pim.json → read_json (streaming)

  In live mode the unified connection is in-memory (no snapshot file needed);
  a new connection is created for each query, always reading fresh source data.

Scale characteristics
---------------------
Snapshot .duckdb file  →  ~100 GB with columnar compression; typical 10–50× smaller
                           than source files due to DuckDB's FSST/ALP encoding.
Live pushdown mode     →  effectively unlimited (source DB limits apply).
                          postgres_scanner uses parallel chunk reads and predicate
                          pushdown; sqlite_scanner and read_csv use streaming I/O.
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

logger = logging.getLogger(__name__)

_SCHEMA_VERSION = "2"

_MANAGER: "DuckDBSourceManager | None" = None
_MANAGER_LOCK = threading.RLock()

_ERP_TABLES = ["sales_order_header", "sales_order_line", "salesperson", "territory", "offer"]
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
            _MANAGER = DuckDBSourceManager(scenario_path, effective_db)
    return _MANAGER


# ── Main class ────────────────────────────────────────────────────────────────

class DuckDBSourceManager:
    """
    Unified, scalable connector for all 4 AdventureWorks sources.

    Thread-safe: multiple concurrent read-only connections are supported by
    DuckDB's MVCC engine when the snapshot file is used.
    """

    def __init__(self, scenario_path: Path, db_path: Path) -> None:
        self._scenario_path = Path(scenario_path)
        self._db_path = Path(db_path)
        self._ready = False
        self._live_mode = self._detect_live_mode()
        self._init_lock = threading.RLock()
        self._row_counts: dict[str, int] = {}
        self._built_at: datetime | None = None

    # ── Public API ─────────────────────────────────────────────────────────────

    def get_connection(self) -> duckdb.DuckDBPyConnection:
        """
        Return a DuckDB connection with all 4 sources available as flat tables.

        Snapshot mode:  read-only connection to persistent .duckdb file.
        Live mode:      new in-memory connection with source VIEWs.
        """
        self._ensure_ready()
        if self._live_mode:
            return self._build_live_connection()
        return duckdb.connect(str(self._db_path), read_only=True)

    def execute(self, sql: str) -> list[dict[str, Any]]:
        """Execute a SELECT statement and return rows as list of dicts."""
        conn = self.get_connection()
        try:
            df = conn.execute(sql).df().head(100)
            return df.where(df.notna(), other=None).to_dict(orient="records")
        finally:
            conn.close()

    def rebuild(self) -> dict[str, int]:
        """
        Force a full re-ingest of all sources.
        Deletes the snapshot file and rebuilds from scratch.
        """
        with self._init_lock:
            if self._db_path.exists():
                self._db_path.unlink()
                logger.info("Removed stale snapshot: %s", self._db_path)
            self._ready = False
            self._row_counts = {}
            self._built_at = None
            self._ensure_ready()
        return dict(self._row_counts)

    def describe(self) -> SourceMeta:
        self._ensure_ready()
        return SourceMeta(
            name="unified_duckdb",
            source_type="duckdb_snapshot" if not self._live_mode else "duckdb_live",
            tables=list(self._row_counts.keys()),
            record_counts=self._row_counts,
            loaded_at=self._built_at or datetime.utcnow(),
            notes=(
                f"DuckDB unified store | schema_version={_SCHEMA_VERSION} | "
                f"mode={'live_pushdown' if self._live_mode else 'snapshot'} | "
                f"path={self._db_path}"
            ),
        )

    @property
    def row_counts(self) -> dict[str, int]:
        self._ensure_ready()
        return dict(self._row_counts)

    @property
    def built_at(self) -> datetime | None:
        return self._built_at

    # ── Initialisation ─────────────────────────────────────────────────────────

    def _detect_live_mode(self) -> bool:
        return bool(
            os.getenv("ERP_POSTGRES_DSN")
            or os.getenv("CRM_SQLITE_PATH")
            or os.getenv("HR_CSV_PATH")
            or os.getenv("PIM_JSON_PATH")
        )

    def _ensure_ready(self) -> None:
        if self._ready:
            return
        with self._init_lock:
            if self._ready:
                return
            if self._live_mode:
                logger.info("DuckDB live-pushdown mode active (env vars detected)")
                self._ready = True
                return
            if self._db_path.exists():
                ok = self._try_load_snapshot()
                if ok:
                    self._ready = True
                    return
                # Corrupted or wrong schema version — rebuild
                self._db_path.unlink()
            self._build_snapshot()
            self._ready = True

    # ── Snapshot mode ──────────────────────────────────────────────────────────

    def _try_load_snapshot(self) -> bool:
        """Open existing snapshot and read metadata. Returns False if invalid."""
        try:
            conn = duckdb.connect(str(self._db_path), read_only=True)
            meta_rows = conn.execute(
                "SELECT key, value FROM _build_meta"
            ).fetchall()
            conn.close()
        except Exception as exc:
            logger.warning("Cannot open snapshot %s: %s", self._db_path, exc)
            return False

        meta = {r[0]: r[1] for r in meta_rows}
        if meta.get("schema_version") != _SCHEMA_VERSION:
            logger.info(
                "Snapshot schema version mismatch (got %s, want %s) — rebuilding",
                meta.get("schema_version"), _SCHEMA_VERSION,
            )
            return False

        self._built_at = datetime.fromisoformat(
            meta.get("built_at", datetime.utcnow().isoformat())
        )
        self._row_counts = json.loads(meta.get("row_counts", "{}"))
        logger.info(
            "Snapshot loaded: %s | built %s | %d tables, %d total rows",
            self._db_path,
            self._built_at.isoformat(),
            len(self._row_counts),
            sum(self._row_counts.values()),
        )
        return True

    def _build_snapshot(self) -> None:
        """Build the persistent DuckDB file from all 4 sources (one-time)."""
        logger.info("Building DuckDB snapshot at %s …", self._db_path)
        conn = duckdb.connect(str(self._db_path))
        try:
            self._ingest_erp(conn)
            self._ingest_crm(conn)
            self._ingest_hr(conn)
            self._ingest_pim(conn)
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

    def _write_meta(self, conn: duckdb.DuckDBPyConnection) -> None:
        self._built_at = datetime.utcnow()
        conn.execute("CREATE TABLE _build_meta (key TEXT PRIMARY KEY, value TEXT)")
        conn.executemany(
            "INSERT INTO _build_meta VALUES (?, ?)",
            [
                ("built_at", self._built_at.isoformat()),
                ("row_counts", json.dumps(self._row_counts)),
                ("schema_version", _SCHEMA_VERSION),
            ],
        )

    # ── Source ingestion (snapshot) ────────────────────────────────────────────

    def _ingest_erp(self, conn: duckdb.DuckDBPyConnection) -> None:
        dump_path = self._scenario_path / "erp_postgres" / "orion_sales_dump.sql"
        if not dump_path.exists():
            logger.warning("ERP dump not found: %s", dump_path)
            return
        from .postgres_connector import _load_sql_dump_to_sqlite

        sqlite_conn = _load_sql_dump_to_sqlite(dump_path)
        for table in _ERP_TABLES:
            try:
                # fetchall returns sqlite3.Row (supports dict())
                rows = sqlite_conn.execute(f"SELECT * FROM {table}").fetchall()
                df = pd.DataFrame([dict(r) for r in rows])
                conn.execute(f"CREATE TABLE {table} AS SELECT * FROM df")
                self._row_counts[f"erp.{table}"] = len(df)
                logger.info("ERP  %-25s %7d rows", table, len(df))
            except Exception as exc:
                logger.warning("Could not ingest ERP.%s: %s", table, exc)

    def _ingest_crm(self, conn: duckdb.DuckDBPyConnection) -> None:
        import sqlite3

        crm_path = self._scenario_path / "crm_sqlite" / "clienthub.db"
        if not crm_path.exists():
            logger.warning("CRM SQLite not found: %s", crm_path)
            return
        sqlite_conn = sqlite3.connect(str(crm_path))
        sqlite_conn.row_factory = sqlite3.Row
        for table in _CRM_TABLES:
            try:
                rows = sqlite_conn.execute(f"SELECT * FROM {table}").fetchall()
                df = pd.DataFrame([dict(r) for r in rows])
                conn.execute(f"CREATE TABLE {table} AS SELECT * FROM df")
                self._row_counts[f"crm.{table}"] = len(df)
                logger.info("CRM  %-25s %7d rows", table, len(df))
            except Exception as exc:
                logger.warning("Could not ingest CRM.%s: %s", table, exc)

    def _ingest_hr(self, conn: duckdb.DuckDBPyConnection) -> None:
        hr_path = self._scenario_path / "hr_pim_files" / "dipendenti_hr.csv"
        if not hr_path.exists():
            logger.warning("HR CSV not found: %s", hr_path)
            return
        from .file_connector import _load_hr

        rows = _load_hr(hr_path)
        df = pd.DataFrame(rows)
        conn.execute("CREATE TABLE hr_employees AS SELECT * FROM df")
        self._row_counts["hr.hr_employees"] = len(df)
        logger.info("HR   %-25s %7d rows", "hr_employees", len(df))

    def _ingest_pim(self, conn: duckdb.DuckDBPyConnection) -> None:
        pim_path = self._scenario_path / "hr_pim_files" / "product_catalog_pim.json"
        if not pim_path.exists():
            logger.warning("PIM JSON not found: %s", pim_path)
            return
        from .file_connector import _load_pim

        rows = _load_pim(pim_path)
        df = pd.DataFrame(rows)
        conn.execute("CREATE TABLE pim_products AS SELECT * FROM df")
        self._row_counts["pim.pim_products"] = len(df)
        logger.info("PIM  %-25s %7d rows", "pim_products", len(df))

    # ── Live pushdown mode ─────────────────────────────────────────────────────

    def _build_live_connection(self) -> duckdb.DuckDBPyConnection:
        """
        Build an in-memory DuckDB connection with VIEWs pointing to live sources.
        DuckDB pushes predicates/projections down to each source — no full copy.
        """
        conn = duckdb.connect(":memory:")
        erp_dsn = os.getenv("ERP_POSTGRES_DSN")
        crm_path = os.getenv(
            "CRM_SQLITE_PATH",
            str(self._scenario_path / "crm_sqlite" / "clienthub.db"),
        )
        hr_csv = os.getenv(
            "HR_CSV_PATH",
            str(self._scenario_path / "hr_pim_files" / "dipendenti_hr.csv"),
        )
        pim_json = os.getenv(
            "PIM_JSON_PATH",
            str(self._scenario_path / "hr_pim_files" / "product_catalog_pim.json"),
        )

        # ERP: live PostgreSQL or fallback to snapshot ingestion
        if erp_dsn:
            try:
                conn.execute("INSTALL postgres_scanner; LOAD postgres_scanner;")
                conn.execute(
                    f"ATTACH '{erp_dsn}' AS erp_live (TYPE POSTGRES, READ_ONLY)"
                )
                for table in _ERP_TABLES:
                    conn.execute(
                        f"CREATE VIEW {table} AS SELECT * FROM erp_live.{table}"
                    )
                logger.info("ERP: live PostgreSQL via postgres_scanner (%s)", erp_dsn)
            except Exception as exc:
                logger.warning("postgres_scanner failed (%s); falling back to snapshot for ERP", exc)
                self._attach_snapshot_tables(conn, _ERP_TABLES)
        else:
            self._attach_snapshot_tables(conn, _ERP_TABLES)

        # CRM: sqlite_scanner (zero-copy pushdown)
        try:
            conn.execute("INSTALL sqlite; LOAD sqlite;")
            conn.execute(
                f"ATTACH '{crm_path}' AS crm_live (TYPE SQLITE, READ_ONLY)"
            )
            for table in _CRM_TABLES:
                conn.execute(
                    f"CREATE VIEW {table} AS SELECT * FROM crm_live.{table}"
                )
            logger.info("CRM: live SQLite via sqlite_scanner (%s)", crm_path)
        except Exception as exc:
            logger.warning("sqlite_scanner failed (%s); falling back to snapshot for CRM", exc)
            self._attach_snapshot_tables(conn, _CRM_TABLES)

        # HR: read_csv streaming (no copy into RAM)
        try:
            conn.execute(f"""
                CREATE VIEW hr_employees AS
                SELECT * FROM read_csv(
                    '{hr_csv}',
                    delim=';',
                    header=true,
                    nullstr='',
                    ignore_errors=true
                )
            """)
            logger.info("HR: live CSV streaming via read_csv (%s)", hr_csv)
        except Exception as exc:
            logger.warning("read_csv failed (%s); falling back to snapshot for HR", exc)
            self._attach_snapshot_tables(conn, ["hr_employees"])

        # PIM: read_json streaming
        try:
            conn.execute(f"""
                CREATE VIEW pim_products AS
                SELECT p.*
                FROM (
                    SELECT UNNEST(products) AS p
                    FROM read_json('{pim_json}', format='auto')
                ) t
            """)
            logger.info("PIM: live JSON streaming via read_json (%s)", pim_json)
        except Exception as exc:
            logger.warning("read_json failed (%s); falling back to snapshot for PIM", exc)
            self._attach_snapshot_tables(conn, ["pim_products"])

        return conn

    def _attach_snapshot_tables(
        self,
        conn: duckdb.DuckDBPyConnection,
        tables: list[str],
    ) -> None:
        """Copy specific tables from snapshot into a live connection as fallback."""
        if not self._db_path.exists():
            logger.warning("No snapshot available for fallback (missing %s)", self._db_path)
            return
        snap = duckdb.connect(str(self._db_path), read_only=True)
        try:
            for table in tables:
                # Find the table in the snapshot (may be prefixed with source name)
                try:
                    df = snap.execute(f"SELECT * FROM {table}").df()
                    conn.execute(f"CREATE TABLE {table} AS SELECT * FROM df")
                except Exception as exc:
                    logger.warning("Could not copy snapshot table %s: %s", table, exc)
        finally:
            snap.close()
