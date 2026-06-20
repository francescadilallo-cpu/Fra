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
from collections.abc import Iterator
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


def _safe_ingest_error(
    exc: Exception,
    *,
    fallback: str = "Ingestion failed — please check the source configuration and try again",
) -> str:
    """Return a user-safe error string for source ingestion failures.

    Our own ValueError/FileNotFoundError/NotImplementedError carry crafted
    messages the user needs to see.  Any other exception type (DuckDB catalog
    errors, driver internals, etc.) is replaced with *fallback* so internal
    details stay out of API responses.
    """
    if isinstance(exc, (ValueError, FileNotFoundError, NotImplementedError)):
        return str(exc)
    return fallback


_ORION_CONTEXT_DOC = """\
OrionSales — Business Context for AI SQL Generation

Revenue disambiguation:
- "fatturato" / "revenue" maps to two ERP fields — always clarify:
  - subtotal_amount (SalesOrderHeader.SubTotal): net commercial revenue ~$20.1M. Use for board KPIs and product analysis.
  - total_due (SalesOrderHeader.TotalDue): gross billed amount including tax and freight ~$22.4M. Use for customer billing totals.
- The $2.3M gap is tax + freight. Default to subtotal_amount unless the user explicitly requests gross/total_due.

CRM deduplication:
- The CRM accounts table has 372 duplicate records with accountId < 0 (legacy migration artifacts).
- Always filter: WHERE accountId > 0 for real customer counts.
- True unique customer count: 19,829 (raw: 20,201).

Cross-source bridges (semantic joins):
- PLACED_BY: ERP SalesOrderHeader.CustomerID → CRM accounts.accountId (customer resolution)
- SOLD_BY: ERP SalesOrderHeader.SalesPersonID → HR dipendenti_hr.MatricolaDip (Italian schema)
- OF_PRODUCT: ERP SalesOrderLine.ProductID → PIM product_catalog_pim.internal_id

HR schema — Italian column names:
- MatricolaDip = employee_id, cognome = surname, nome = first name
- DataAssunzione = hire_date, ruolo = role, stipendio = salary, repartoId = department_id
- Sales quotas and YTD figures are in the ERP salesperson table, NOT in the HR table.

Key benchmark figures (2014):
- Top salesperson: Linda Mitchell (SalesPersonID 276), salesYTD $4,251,368
- Net revenue 2014: $20,127,627 (subtotal_amount)
- Gross revenue 2014: $22,380,124 (total_due)
- Unique customers: 19,829 (post-dedup)
- Orders: 31,465 (SalesOrderHeader), 121,317 line items (SalesOrderLine)
"""

# Paths at or under these roots are never opened as data sources (defence-in-depth).
_BLOCKED_PATH_ROOTS = ("/etc", "/proc", "/sys", "/dev", "/run", "/boot")


# External-database ingestion copies rows in fixed-size chunks so a large
# source table never has to fit in Python memory all at once.
_INGEST_CHUNK_ROWS = 50_000


def _pg_ingest_limit() -> int:
    """Per-table row cap for the psycopg2 PostgreSQL ingestion path.

    Defaults to 100k to bound memory. Set FRA_PG_INGEST_LIMIT=0 to disable
    the cap, or to a custom value. Invalid values fall back to the default.
    Rows are streamed in chunks, so even FRA_PG_INGEST_LIMIT=0 keeps memory
    bounded by the chunk size rather than the table size.
    """
    raw = os.getenv("FRA_PG_INGEST_LIMIT", "100000").strip()
    try:
        val = int(raw)
    except ValueError:
        return 100000
    return val if val >= 0 else 100000


def _safe_data_path(raw: str) -> Path:
    """Resolve and validate a file path supplied by an admin-configured source.

    Raises ValueError if the resolved path sits at or under a blocked system
    root, preventing accidental or malicious reads of sensitive OS files.
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
        # get_schema_info() runs DESCRIBE + COUNT + sample per table and is
        # called several times per rebuild (catalog populate, phantom prune,
        # KG probe, KG build). The snapshot only changes on rebuild/ingest,
        # so memoise the result and invalidate on those paths. The generation
        # counter prevents a compute that started before an invalidation from
        # storing stale data afterwards.
        self._schema_cache_lock = threading.Lock()
        self._schema_info_cache: dict[str, dict] | None = None
        self._schema_gen = 0
        # In nostore mode, the unified in-memory DuckDB is built once and kept
        # alive for the process; callers get cheap cursors on it instead of a
        # full re-ingest on every query.
        self._mem_conn: duckdb.DuckDBPyConnection | None = None
        mode = os.getenv("FRA_STORAGE_MODE", "snapshot").strip().lower()
        self._storage_mode = mode if mode in {"nostore", "snapshot"} else "nostore"

        self._seed_defaults()

    def _invalidate_schema_cache(self) -> None:
        with self._schema_cache_lock:
            self._schema_info_cache = None
            self._schema_gen += 1

    # ── Public API ─────────────────────────────────────────────────────────────

    def get_connection(self) -> duckdb.DuckDBPyConnection:
        """Return a DuckDB connection for current storage mode.

        In nostore mode this hands out a fresh cursor on the prebuilt in-memory
        database (cheap) rather than re-ingesting every source on each call. The
        cursor shares the underlying data and is safe to use and close per query.
        """
        self._ensure_ready()
        if self._storage_mode == "nostore":
            assert self._mem_conn is not None  # set by _ensure_ready
            return self._mem_conn.cursor()
        return duckdb.connect(str(self._db_path), read_only=True)

    def execute(
        self, sql: str, params: tuple[Any, ...] = (), limit: int = 100
    ) -> list[dict[str, Any]]:
        """Execute a SELECT and return up to *limit* rows (for frontend queries).

        Fetches directly from the cursor instead of materialising the full
        result as a DataFrame first: a query without a LIMIT clause against a
        multi-million-row table (e.g. LLM-generated SQL) would otherwise be
        pulled entirely into memory just to be truncated to a handful of rows
        afterwards. As a side effect, NULLs come back as native ``None``
        rather than pandas ``NaN`` (the previous ``df.where(df.notna(), ...)``
        pass did not actually convert NaN to None for numeric columns, since
        pandas coerces ``None`` back to ``NaN`` in float dtype columns).
        """
        conn = self.get_connection()
        try:
            cur = conn.execute(sql, params) if params else conn.execute(sql)
            columns = [d[0] for d in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchmany(limit)]
        finally:
            conn.close()

    def execute_all(
        self, sql: str, params: tuple[Any, ...] = ()
    ) -> list[dict[str, Any]]:
        """Execute a SELECT and return ALL rows (for KG/catalog bulk loads).

        Fetches directly from the cursor rather than materialising a
        DataFrame first. Besides skipping the pandas conversion overhead for
        what can be multi-million-row tables, this hands back SQL NULLs as
        native ``None`` rather than pandas ``NaN``: ``df.where(df.notna(),
        other=None)`` does not actually convert NaN to None in numeric
        columns (pandas coerces ``None`` back to ``NaN`` on assignment into a
        float-dtype column), and downstream consumers such as
        ``KnowledgeGraph._load_crm_customers`` call ``str``-only helpers like
        ``_norm_email`` on these values — which crash on a stray float NaN.
        """
        conn = self.get_connection()
        try:
            cur = conn.execute(sql, params) if params else conn.execute(sql)
            columns = [d[0] for d in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]
        finally:
            conn.close()

    def execute_iter(
        self,
        sql: str,
        params: tuple[Any, ...] = (),
        batch_size: int = 10000,
    ) -> "Iterator[dict[str, Any]]":
        """Yield result rows in batches without materialising the whole set.

        Lets bulk consumers (e.g. the KG builder) process or cap a large table
        without first loading every row into one Python list. The connection
        stays open for the lifetime of the generator and is closed when it is
        exhausted or garbage-collected (e.g. when the consumer stops early).
        """
        conn = self.get_connection()
        try:
            cur = conn.execute(sql, params) if params else conn.execute(sql)
            columns = [d[0] for d in cur.description]
            while True:
                batch = cur.fetchmany(batch_size)
                if not batch:
                    break
                for row in batch:
                    yield dict(zip(columns, row))
        finally:
            conn.close()

    def rebuild(self) -> dict[str, int]:
        """Force full re-ingest of all active sources."""
        with self._init_lock:
            if self._storage_mode == "snapshot" and self._db_path.exists():
                self._db_path.unlink()
                logger.info("Removed stale snapshot: %s", self._db_path)
            # Drop our reference to the old in-memory DB. Any cursor still in
            # flight keeps it alive (DuckDB refcounts the database via its
            # connections), so this never breaks a concurrent query; the old DB
            # is freed once those cursors close.
            self._mem_conn = None
            self._ready = False
            self._row_counts = {}
            self._built_at = None
            self._invalidate_schema_cache()
            self._ensure_ready()
        return dict(self._row_counts)

    def ingest_one(self, source_id: str) -> dict[str, int]:
        """Re-ingest a single source.

        In **snapshot** mode this updates only the target source's tables in the
        existing snapshot, leaving every other source untouched — so syncing one
        small source no longer forces a re-ingest of all the others. Any failure
        falls back to a full rebuild so correctness is never compromised.

        In **nostore** mode (ephemeral, rebuilt on every connection) there is no
        persistent snapshot to patch, so it delegates to rebuild().
        """
        cfg = self._registry.get(source_id)
        if cfg is None:
            raise KeyError(f"Source '{source_id}' not found in registry")
        self._registry.patch(source_id, status="syncing", error_msg=None)

        if self._storage_mode == "snapshot" and self._db_path.exists():
            with self._init_lock:
                # Ensure row_counts/built_at reflect the current snapshot.
                self._ensure_ready()
                # _ingest_incremental() opens its own read-write connection on
                # db_path; DuckDB refuses a second connection to the same file
                # with a different config (read_only=True vs. read-write) while
                # one is already open in this process — it raises
                # ConnectionException immediately rather than queuing the
                # request. Flip _ready False first, exactly like rebuild()
                # does, so concurrent get_connection() callers take the slow
                # path in _ensure_ready(), block on _init_lock (an RLock —
                # nesting into rebuild() below is safe) instead of racing our
                # write connection, and only resume once the snapshot is
                # provably consistent again — whether that's via a successful
                # incremental ingest or the full-rebuild fallback.
                self._ready = False
                self._invalidate_schema_cache()
                try:
                    self._ingest_incremental(cfg)
                except Exception as exc:
                    logger.warning(
                        "Incremental ingest of '%s' failed (%s) — falling back "
                        "to full rebuild",
                        source_id,
                        exc,
                    )
                    return self.rebuild()
                self._ready = True
                return dict(self._row_counts)

        return self.rebuild()

    def _ingest_incremental(self, cfg: SourceConfig) -> None:
        """Replace a single source's tables in the existing snapshot in place.

        Drops the tables the source previously owned (ingesters use
        CREATE TABLE IF NOT EXISTS, so a clean drop is required for fresh data),
        re-ingests just this source, then rewrites the build metadata.
        """
        old_tables = list(cfg.target_tables)
        conn = duckdb.connect(str(self._db_path))
        try:
            for table in old_tables:
                safe = table.replace('"', '""')
                conn.execute(f'DROP TABLE IF EXISTS "{safe}"')

            # Forget this source's old row counts; the ingester repopulates them.
            prefix = f"{cfg.id}."
            self._row_counts = {
                k: v for k, v in self._row_counts.items() if not k.startswith(prefix)
            }
            # The ingester appends to target_tables — start clean to avoid dupes.
            cfg.target_tables = []
            self._ingest_source(conn, cfg)

            self._write_meta(conn)
            conn.execute("CHECKPOINT")
        finally:
            conn.close()

        now = datetime.utcnow().isoformat()
        self._registry.patch(
            cfg.id,
            status="active",
            error_msg=None,
            last_sync_at=now,
            target_tables=cfg.target_tables,
            row_count=sum(
                v for k, v in self._row_counts.items() if k.startswith(f"{cfg.id}.")
            ),
        )

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

        Memoised until the next rebuild/ingest — callers treat the result as
        read-only.
        """
        self._ensure_ready()
        with self._schema_cache_lock:
            if self._schema_info_cache is not None:
                return self._schema_info_cache
            gen = self._schema_gen
        conn = self.get_connection()
        try:
            # Underscore-prefixed tables (_build_meta, …) are internal snapshot
            # bookkeeping: surfacing them here would leak them into the catalog,
            # the semantic draft's entity list, LLM schema prompts and the KG.
            tables = [
                r[0]
                for r in conn.execute("SHOW TABLES").fetchall()
                if not str(r[0]).startswith("_")
            ]
            result: dict[str, dict] = {}
            for table in tables:
                safe = table.replace('"', '""')
                try:
                    cols = conn.execute(f'DESCRIBE "{safe}"').fetchall()
                    _row = conn.execute(
                        f'SELECT COUNT(*) AS n FROM "{safe}"'
                    ).fetchone()
                    count = int(_row[0]) if _row else 0
                    # Fetch from the cursor rather than via .df().where(.notna(), ...):
                    # the latter leaves NaN (not None) in numeric columns, which then
                    # pollutes catalog sample_values with literal "nan" strings and
                    # understates nullability_rate in populate_from_manager().
                    sample_cur = conn.execute(f'SELECT * FROM "{safe}" LIMIT 5')
                    sample_cols = [d[0] for d in sample_cur.description]
                    sample = [
                        dict(zip(sample_cols, row)) for row in sample_cur.fetchall()
                    ]
                    result[table] = {
                        "columns": [{"name": c[0], "type": c[1]} for c in cols],
                        "row_count": count,
                        "sample": sample,
                    }
                except Exception as exc:
                    logger.warning(
                        "get_schema_info: skipping table '%s': %s", table, exc
                    )
            with self._schema_cache_lock:
                # Only cache if no rebuild/ingest invalidated us mid-scan.
                if gen == self._schema_gen:
                    self._schema_info_cache = result
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

        Only runs when FRA_SEED_DEMO_SOURCES=true — intended for demo deployments
        that ship with the test_scenario dataset (Adventure Works / OrionSales).
        Live deployments leave this unset so the registry starts empty and admins
        configure their own sources via the UI.
        """
        seed_enabled = os.getenv("FRA_SEED_DEMO_SOURCES", "false").strip().lower() in {
            "1",
            "true",
            "yes",
        }
        if not seed_enabled:
            return

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

        # Seed a context_doc source if none exists yet — injects business
        # context (revenue disambiguation, CRM dedup rules, cross-source
        # bridges) into LLM SQL generation prompts.
        has_context_doc = any(
            c.connector_type == "context_doc" for c in self._registry.list()
        )
        if not has_context_doc:
            self._registry.upsert(
                SourceConfig(
                    id="context_orion",
                    connector_type="context_doc",
                    label="OrionSales — Business Context",
                    params={"content": _ORION_CONTEXT_DOC},
                    is_default=True,
                )
            )
            logger.info("Seeded default context document into registry")

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
                # Build the unified in-memory database once and keep it alive;
                # get_connection() then hands out cheap cursors on it.
                mem = duckdb.connect(":memory:")
                self._populate_connection(mem)
                self._mem_conn = mem
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
                self._registry.patch(
                    cfg.id, status="error", error_msg=_safe_ingest_error(exc)
                )
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
        elif ctype == "mysql":
            self._ingest_mysql(conn, cfg)
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
        import tempfile

        # Support inline CSV (uploaded from browser), HTTP(S) URL, or local file path
        _MAX_INLINE_BYTES = 5 * 1024 * 1024  # 5 MB guard against OOM
        inline = cfg.params.get("inline_csv")
        table = cfg.params.get("table_name") or "imported_data"
        if "inline_csv" in cfg.params and not (inline and inline.strip()):
            # An empty upload must fail with a clear message, not fall through
            # to the file-path branch and surface a server-path IO error.
            raise ValueError("CSV is empty — upload a file with a header and rows")
        if inline:
            # Small browser uploads — pandas is fine and avoids a temp file.
            if len(inline.encode("utf-8")) > _MAX_INLINE_BYTES:
                raise ValueError(f"Inline CSV exceeds 5 MB limit ({len(inline)} chars)")
            df = pd.read_csv(io.StringIO(inline), sep=",", low_memory=False)
            safe_table = table.replace('"', '""')
            conn.execute(
                f'CREATE TABLE IF NOT EXISTS "{safe_table}" AS SELECT * FROM df'
            )
            n = len(df)
        else:
            raw_path = cfg.params.get("path", "")
            # URL path: download to a temp file, then read locally
            tmp_path: str | None = None
            if raw_path.startswith(("http://", "https://")):
                import httpx
                import re as _re

                # Auto-convert Google Sheets view/edit URLs to CSV export URLs so
                # users can paste the sharing link directly without needing to know
                # the /export?format=csv URL pattern.
                download_url = raw_path
                _gs_match = _re.match(
                    r"https://docs\.google\.com/spreadsheets/d/([^/]+)/(?:edit|view|pub)",
                    raw_path,
                )
                if _gs_match and "export" not in raw_path:
                    sheet_id = _gs_match.group(1)
                    # Preserve gid param if present (e.g. #gid=12345 or ?gid=12345)
                    gid_match = _re.search(r"[?&#]gid=(\d+)", raw_path)
                    gid_suffix = f"&gid={gid_match.group(1)}" if gid_match else ""
                    download_url = (
                        f"https://docs.google.com/spreadsheets/d/{sheet_id}"
                        f"/export?format=csv{gid_suffix}"
                    )
                    logger.info(
                        "Google Sheets URL auto-converted to CSV export: %s",
                        download_url,
                    )

                try:
                    resp = httpx.get(download_url, follow_redirects=True, timeout=30)
                    resp.raise_for_status()
                except httpx.HTTPStatusError as exc:
                    raise ValueError(
                        f"Failed to download CSV from URL (HTTP {exc.response.status_code}): {raw_path}"
                    ) from exc
                except httpx.RequestError as exc:
                    raise ValueError(
                        f"Could not reach URL — check the address and network access: {raw_path}"
                    ) from exc
                # Sanity-check: reject clearly non-CSV responses (HTML login pages etc.)
                content_type = resp.headers.get("content-type", "")
                if "text/html" in content_type and "text/csv" not in content_type:
                    raise ValueError(
                        f"URL returned HTML instead of CSV — the file may require login "
                        f"or the link may not be publicly shared: {raw_path}"
                    )
                with tempfile.NamedTemporaryFile(
                    suffix=".csv", delete=False, mode="wb"
                ) as tmp:
                    tmp.write(resp.content)
                    tmp_path = tmp.name
                path = Path(tmp_path)
            else:
                path = _safe_data_path(raw_path)
                if not path.exists():
                    raise FileNotFoundError(f"CSV not found: {path}")
            try:
                table = table or path.stem.replace("-", "_").replace(" ", "_").lower()
                safe_table = table.replace('"', '""')
                delimiter = cfg.params.get("delimiter", ",")
                safe_path = str(path).replace("'", "''")
                safe_delim = delimiter.replace("'", "''")
                # Stream the file straight into DuckDB — DuckDB parses it natively
                # (parallel, out-of-core) instead of materialising the whole file in
                # a pandas DataFrame in Python memory.
                try:
                    conn.execute(
                        f'CREATE TABLE IF NOT EXISTS "{safe_table}" AS '
                        f"SELECT * FROM read_csv_auto('{safe_path}', "
                        f"delim='{safe_delim}', header=true)"
                    )
                except Exception as exc:
                    raise ValueError(
                        f"Cannot parse CSV file '{path.name}': {exc} — "
                        "check that the file has a header row and consistent columns."
                    ) from exc
                _row = conn.execute(f'SELECT COUNT(*) FROM "{safe_table}"').fetchone()
                n = _row[0] if _row is not None else 0
            finally:
                if tmp_path:
                    import os

                    os.unlink(tmp_path)
        self._row_counts[f"{cfg.id}.{table}"] = n
        logger.info("CSV  %-25s %7d rows", table, n)
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
        safe_table = table.replace('"', '""')
        records_key = cfg.params.get("records_key")
        if not records_key:
            # Top-level array (or ndjson): let DuckDB stream it natively instead
            # of loading the whole document into Python + a pandas DataFrame.
            safe_path = str(path).replace("'", "''")
            try:
                conn.execute(
                    f'CREATE TABLE IF NOT EXISTS "{safe_table}" AS '
                    f"SELECT * FROM read_json_auto('{safe_path}')"
                )
                _row = conn.execute(f'SELECT COUNT(*) FROM "{safe_table}"').fetchone()
                n = _row[0] if _row is not None else 0
                self._row_counts[f"{cfg.id}.{table}"] = n
                logger.info("JSON %-25s %7d rows", table, n)
                if table not in cfg.target_tables:
                    cfg.target_tables.append(table)
                return
            except Exception as exc:
                # Fall back to the pandas path (e.g. an object-wrapped payload
                # DuckDB's sniffer can't flatten) rather than failing the sync.
                logger.info(
                    "JSON native read failed for %s (%s) — using pandas fallback",
                    table,
                    exc,
                )

        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"JSON file '{path.name}' is not valid JSON: {exc}"
            ) from exc
        if records_key:
            records = raw.get(records_key) if isinstance(raw, dict) else None
            if records is None:
                available = (
                    ", ".join(f"'{k}'" for k in raw.keys())
                    if isinstance(raw, dict)
                    else "(not an object)"
                )
                raise ValueError(
                    f"JSON file '{path.name}': records_key '{records_key}' not found. "
                    f"Available top-level keys: {available}"
                )
        else:
            records = raw if isinstance(raw, list) else raw.get("records", raw)
        if not isinstance(records, list):
            raise ValueError(
                f"JSON file '{path.name}' must be a top-level array or an object containing a list "
                f"under '{records_key or 'records'}' — got {type(records).__name__}"
            )
        df = pd.DataFrame(records)
        conn.execute(f'CREATE TABLE IF NOT EXISTS "{safe_table}" AS SELECT * FROM df')
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
        safe_table = table.replace('"', '""')
        try:
            df = pd.read_excel(str(path), sheet_name=sheet)
        except Exception as exc:
            raise ValueError(f"Cannot read Excel file '{path.name}': {exc}") from exc
        if len(df) == 0:
            raise ValueError(
                f"Excel file '{path.name}' contains no data rows — "
                "check that the sheet has a header row and at least one data row."
            )
        conn.execute(f'CREATE TABLE IF NOT EXISTS "{safe_table}" AS SELECT * FROM df')
        self._row_counts[f"{cfg.id}.{table}"] = len(df)
        logger.info("XLS  %-25s %7d rows", table, len(df))
        if table not in cfg.target_tables:
            cfg.target_tables.append(table)

    def _stream_cursor_into_table(
        self,
        conn: duckdb.DuckDBPyConnection,
        cur: Any,
        safe_table: str,
        row_limit: int = 0,
    ) -> tuple[int, bool]:
        """Copy a DB-API cursor into a DuckDB table in fixed-size chunks.

        Keeps memory bounded by the chunk size rather than the source table
        size: each chunk becomes a small DataFrame that is appended and then
        discarded. Returns ``(row_count, truncated)``; with ``row_limit > 0``
        ingestion stops at the limit and ``truncated`` reports whether the
        source had more rows.
        """
        total = 0
        created = False
        truncated = False
        while True:
            batch = cur.fetchmany(_INGEST_CHUNK_ROWS)
            if not batch:
                break
            if row_limit > 0 and total + len(batch) > row_limit:
                batch = batch[: row_limit - total]
                truncated = True
                if not batch:
                    break
            df = pd.DataFrame([dict(r) for r in batch])
            if created:
                conn.execute(f'INSERT INTO "{safe_table}" SELECT * FROM df')
            else:
                conn.execute(
                    f'CREATE TABLE IF NOT EXISTS "{safe_table}" AS SELECT * FROM df'
                )
                created = True
            total += len(df)
            if truncated:
                break
        if not created:
            # Empty source table: still create the target with the cursor's
            # column names so downstream introspection sees a real table.
            cols = ", ".join(
                '"' + str(d[0]).replace('"', '""') + '" VARCHAR'
                for d in (cur.description or [])
            )
            if cols:
                conn.execute(f'CREATE TABLE IF NOT EXISTS "{safe_table}" ({cols})')
        return total, truncated

    def _ingest_sqlite_generic(
        self, conn: duckdb.DuckDBPyConnection, cfg: SourceConfig
    ) -> None:
        import sqlite3 as _sqlite3

        path = _safe_data_path(cfg.params.get("path", ""))
        if not path.exists():
            raise FileNotFoundError(f"SQLite not found: {path}")
        table_filter: list[str] | None = cfg.params.get("tables")
        try:
            src = _sqlite3.connect(str(path))
        except _sqlite3.Error as exc:
            raise ValueError(
                f"Cannot open SQLite file '{path.name}': {exc} — "
                "the file may be corrupted, locked, or in use by another process."
            ) from exc
        src.row_factory = _sqlite3.Row
        try:
            all_tables = [
                r[0]
                for r in src.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                ).fetchall()
            ]
            if table_filter:
                tables = [t for t in all_tables if t in table_filter]
                missing = [t for t in table_filter if t not in all_tables]
                if missing:
                    available = ", ".join(all_tables) or "none"
                    raise ValueError(
                        f"Table(s) not found in '{path.name}': {', '.join(missing)}. "
                        f"Available tables: {available}"
                    )
            else:
                tables = all_tables
            if not tables:
                raise ValueError(
                    f"SQLite file '{path.name}' contains no user tables — "
                    "the file may be empty or only contain internal SQLite system tables."
                )
            for table in tables:
                safe_id = table.replace('"', '""')  # escape SQL identifier
                cur = src.execute(f'SELECT * FROM "{safe_id}"')
                n, _ = self._stream_cursor_into_table(conn, cur, safe_id)
                self._row_counts[f"{cfg.id}.{table}"] = n
                logger.info("SDB  %-25s %7d rows", table, n)
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

            limit = _pg_ingest_limit()
            try:
                pg_conn = psycopg2.connect(dsn, connect_timeout=10)
            except psycopg2.OperationalError as exc:
                raise ValueError(
                    f"Cannot connect to PostgreSQL: {exc} — "
                    "check DSN, host reachability, port, and credentials."
                ) from exc
            safe_schema = schema.replace('"', '""')
            try:
                for i, table in enumerate(tables):
                    safe_table = table.replace('"', '""')
                    # Server-side (named) cursor: PostgreSQL streams rows in
                    # batches instead of sending the whole table up front, so
                    # neither side materialises a multi-million-row result.
                    # Named cursors are one-shot — one per table.
                    cur = pg_conn.cursor(
                        name=f"fra_ingest_{i}",
                        cursor_factory=psycopg2.extras.RealDictCursor,
                    )
                    cur.itersize = _INGEST_CHUNK_ROWS
                    try:
                        if limit > 0:
                            # Fetch one extra row so we can detect (and warn
                            # about) silent truncation rather than capping
                            # invisibly.
                            cur.execute(
                                f'SELECT * FROM "{safe_schema}"."{safe_table}" LIMIT {limit + 1}'
                            )
                        else:
                            cur.execute(f'SELECT * FROM "{safe_schema}"."{safe_table}"')
                        n, truncated = self._stream_cursor_into_table(
                            conn, cur, safe_table, row_limit=limit
                        )
                    except psycopg2.ProgrammingError as exc:
                        raise ValueError(
                            f"Table '{table}' not found in schema '{schema}' — "
                            f"check that the table exists and the schema name is correct. "
                            f"(PostgreSQL: {exc})"
                        ) from exc
                    finally:
                        cur.close()
                    if truncated:
                        logger.warning(
                            "PG   %-25s TRUNCATED at %d rows — table has more data. "
                            "Raise FRA_PG_INGEST_LIMIT (or set 0 for unlimited) to "
                            "ingest the full table.",
                            table,
                            limit,
                        )
                    self._row_counts[f"{cfg.id}.{table}"] = n
                    logger.info("PG   %-25s %7d rows", table, n)
                    if table not in cfg.target_tables:
                        cfg.target_tables.append(table)
            finally:
                pg_conn.close()
        except ImportError:
            # Fallback: try DuckDB postgres_scanner
            safe_schema = schema.replace('"', '""')
            try:
                conn.execute("INSTALL postgres_scanner; LOAD postgres_scanner;")
                safe_dsn = dsn.replace("'", "''")
                conn.execute(
                    f"ATTACH '{safe_dsn}' AS _pg_src (TYPE POSTGRES, READ_ONLY)"
                )
            except Exception as exc:
                raise ValueError(
                    f"Cannot connect to PostgreSQL: {exc} — "
                    "check DSN, host reachability, port, and credentials."
                ) from exc
            for table in tables:
                safe_table = table.replace('"', '""')
                try:
                    conn.execute(
                        f'CREATE TABLE IF NOT EXISTS "{safe_table}" AS SELECT * FROM _pg_src."{safe_schema}"."{safe_table}"'
                    )
                except Exception as exc:
                    raise ValueError(
                        f"Table '{table}' not found in schema '{schema}' — "
                        f"check that the table exists and the schema name is correct. "
                        f"(PostgreSQL: {exc})"
                    ) from exc
                _row = conn.execute(f'SELECT COUNT(*) FROM "{safe_table}"').fetchone()
                n = _row[0] if _row is not None else 0
                self._row_counts[f"{cfg.id}.{table}"] = n
                logger.info("PG   %-25s %7d rows", table, n)
                if table not in cfg.target_tables:
                    cfg.target_tables.append(table)

    def _ingest_mysql(self, conn: duckdb.DuckDBPyConnection, cfg: SourceConfig) -> None:
        dsn = cfg.params.get("dsn", "")
        tables: list[str] = cfg.params.get("tables", [])
        if not dsn:
            raise ValueError(
                "MySQL source requires 'dsn' param (mysql://user:pass@host:3306/db)"
            )
        if not tables:
            raise ValueError(
                "MySQL source requires 'tables' param (list of table names)"
            )
        try:
            import urllib.parse

            import pymysql
            import pymysql.cursors

            parsed = urllib.parse.urlparse(dsn)
            my_conn = pymysql.connect(
                host=parsed.hostname or "localhost",
                port=parsed.port or 3306,
                user=parsed.username,
                password=parsed.password or "",
                database=(parsed.path or "").lstrip("/"),
                connect_timeout=10,
                cursorclass=pymysql.cursors.SSDictCursor,  # server-side streaming
            )
            limit = _pg_ingest_limit()
            try:
                for table in tables:
                    safe_bt = table.replace("`", "``")
                    safe_dbt = table.replace('"', '""')
                    with my_conn.cursor() as cur:
                        try:
                            if limit > 0:
                                cur.execute(
                                    f"SELECT * FROM `{safe_bt}` LIMIT {limit + 1}"
                                )
                            else:
                                cur.execute(f"SELECT * FROM `{safe_bt}`")
                        except pymysql.ProgrammingError as exc:
                            raise ValueError(
                                f"Table '{table}' not found in MySQL database — "
                                f"check that the table exists and the database name is correct. "
                                f"(MySQL: {exc})"
                            ) from exc
                        # pymysql SSDictCursor supports fetchmany for chunked streaming
                        n, truncated = self._stream_cursor_into_table(
                            conn, cur, safe_dbt, row_limit=limit
                        )
                    if truncated:
                        logger.warning(
                            "MySQL %-25s TRUNCATED at %d rows — raise "
                            "FRA_PG_INGEST_LIMIT (or set 0) to ingest full table.",
                            table,
                            limit,
                        )
                    self._row_counts[f"{cfg.id}.{table}"] = n
                    logger.info("MySQL %-25s %7d rows", table, n)
                    if table not in cfg.target_tables:
                        cfg.target_tables.append(table)
            finally:
                my_conn.close()
        except ImportError:
            # Fallback: DuckDB mysql_scanner extension (no Python driver needed)
            conn.execute("INSTALL mysql_scanner; LOAD mysql_scanner;")
            safe_dsn = dsn.replace("'", "''")
            conn.execute(f"ATTACH '{safe_dsn}' AS _mysql_src (TYPE MYSQL, READ_ONLY)")
            for table in tables:
                safe_table = table.replace('"', '""')
                conn.execute(
                    f'CREATE TABLE IF NOT EXISTS "{safe_table}" AS '
                    f'SELECT * FROM _mysql_src."{safe_table}"'
                )
                _row = conn.execute(f'SELECT COUNT(*) FROM "{safe_table}"').fetchone()
                n = _row[0] if _row is not None else 0
                self._row_counts[f"{cfg.id}.{table}"] = n
                logger.info("MySQL %-25s %7d rows", table, n)
                if table not in cfg.target_tables:
                    cfg.target_tables.append(table)
        except pymysql.OperationalError as exc:  # type: ignore[possibly-undefined]
            raise ValueError(
                f"Cannot connect to MySQL: {exc} — "
                "check DSN, host reachability, port, and credentials."
            ) from exc

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
        safe_table = table.replace('"', '""')
        safe_path = str(path).replace("'", "''")
        try:
            conn.execute(
                f'CREATE TABLE IF NOT EXISTS "{safe_table}" AS '
                f"SELECT * FROM read_parquet('{safe_path}')"
            )
        except Exception as exc:
            raise ValueError(
                f"Cannot read Parquet file '{path.name}': {exc} — "
                "the file may be corrupted or not a valid Parquet file."
            ) from exc
        _row = conn.execute(f'SELECT COUNT(*) FROM "{safe_table}"').fetchone()
        n = _row[0] if _row is not None else 0
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
        safe_table = table.replace('"', '""')
        return self._mgr.execute_all(f'SELECT * FROM "{safe_table}"')

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
