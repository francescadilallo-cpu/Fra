"""Persistent store for user-facing semantic definitions.

``sl_metrics``, ``sl_hierarchies`` and ``sl_segments`` historically lived
inside the demo fixture DB (``backend/data/erp_mock.db`` at the repo path).
But those tables hold *user* data — custom metrics/hierarchies/segments plus
the metrics applied by the auto-build pipeline — so on an ephemeral host they
were wiped on every deploy even with ``FRA_DATA_DIR`` pointing at a persistent
disk (the fixture deliberately stays at the repo path).

They now live in ``data_dir()/definitions.db``. The first open of a given DB
file migrates any rows from the legacy location once (``INSERT OR IGNORE`` by
primary key, flagged in ``_defs_meta`` so deletions never resurrect on later
boots). Demo builtin rows are seeded directly into this store at startup by
``database.init_db()`` — idempotent per-row checks, same as before.
"""

from __future__ import annotations

import logging
import sqlite3

from .paths import data_dir

logger = logging.getLogger(__name__)

_MIGRATION_FLAG = "migrated_from_legacy"
_TABLES = ("sl_metrics", "sl_hierarchies", "sl_segments")

# Mirrors the legacy DDL in database.py so both schemas stay in lockstep for
# the migration window; the legacy tables remain only as a migration source.
_DDL = """
CREATE TABLE IF NOT EXISTS sl_metrics (
    id TEXT PRIMARY KEY,
    sector_id TEXT NOT NULL DEFAULT 'manufacturing',
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    type TEXT NOT NULL DEFAULT 'sum',
    entity TEXT NOT NULL DEFAULT '',
    field TEXT DEFAULT '',
    numerator TEXT DEFAULT '',
    denominator TEXT DEFAULT '',
    expression TEXT DEFAULT '',
    filters_json TEXT DEFAULT '[]',
    time_dimension TEXT DEFAULT '',
    grains_json TEXT DEFAULT '["month","quarter","year"]',
    format TEXT DEFAULT 'number',
    status TEXT DEFAULT 'draft',
    owner TEXT DEFAULT '',
    tags_json TEXT DEFAULT '[]',
    is_builtin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sl_hierarchies (
    id TEXT PRIMARY KEY,
    sector_id TEXT NOT NULL DEFAULT 'manufacturing',
    name TEXT NOT NULL,
    entity TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    type TEXT NOT NULL DEFAULT 'categorical',
    levels_json TEXT DEFAULT '[]',
    is_builtin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sl_segments (
    id TEXT PRIMARY KEY,
    sector_id TEXT NOT NULL DEFAULT 'manufacturing',
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    entity TEXT NOT NULL DEFAULT '',
    conditions_json TEXT DEFAULT '[]',
    tags_json TEXT DEFAULT '[]',
    used_by_json TEXT DEFAULT '[]',
    is_builtin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sl_metrics_sector ON sl_metrics(sector_id, is_builtin);
CREATE INDEX IF NOT EXISTS idx_sl_hierarchies_sector ON sl_hierarchies(sector_id, is_builtin);
CREATE INDEX IF NOT EXISTS idx_sl_segments_sector ON sl_segments(sector_id, is_builtin);

CREATE TABLE IF NOT EXISTS _defs_meta (key TEXT PRIMARY KEY, value TEXT);
"""


def get_definitions_connection() -> sqlite3.Connection:
    """Open the persistent definitions DB (schema ensured, legacy migrated)."""
    conn = sqlite3.connect(str(data_dir() / "definitions.db"))
    conn.row_factory = sqlite3.Row
    # Same concurrency posture as the other app stores (see database.py).
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.executescript(_DDL)
    try:
        _migrate_legacy_once(conn)
    except Exception as exc:  # noqa: BLE001 — migration is best-effort
        logger.warning("legacy definitions migration skipped: %s", exc)
    return conn


def _migrate_legacy_once(conn: sqlite3.Connection) -> None:
    """Copy sl_* rows from the legacy erp_mock.db exactly once per DB file.

    The flag lives in the *new* DB, so a row the user later deletes is never
    resurrected by a subsequent boot re-running the copy.
    """
    done = conn.execute(
        "SELECT value FROM _defs_meta WHERE key = ?", (_MIGRATION_FLAG,)
    ).fetchone()
    if done:
        return

    from .database import DB_PATH as legacy_path  # noqa: PLC0415 — avoid cycle

    if legacy_path.exists():
        legacy = sqlite3.connect(str(legacy_path))
        legacy.row_factory = sqlite3.Row
        try:
            for table in _TABLES:
                try:
                    rows = legacy.execute(f"SELECT * FROM {table}").fetchall()  # noqa: S608 — fixed table names
                except sqlite3.Error:
                    continue  # legacy table absent — nothing to migrate
                for r in rows:
                    d = dict(r)
                    cols = ", ".join(d.keys())
                    marks = ", ".join("?" for _ in d)
                    conn.execute(
                        f"INSERT OR IGNORE INTO {table} ({cols}) VALUES ({marks})",  # noqa: S608
                        list(d.values()),
                    )
        finally:
            legacy.close()
        logger.info("definitions store: migrated legacy sl_* rows")

    conn.execute(
        "INSERT OR REPLACE INTO _defs_meta (key, value) VALUES (?, 'done')",
        (_MIGRATION_FLAG,),
    )
    conn.commit()
