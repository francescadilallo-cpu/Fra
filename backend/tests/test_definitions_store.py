"""Tests for the persistent semantic-definitions store (definitions.db).

Covers: schema creation under FRA_DATA_DIR, one-shot legacy migration from
erp_mock.db, and the no-resurrection guarantee (a row deleted after migration
must NOT reappear on later opens even though the legacy DB still has it).
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.definitions_store import get_definitions_connection


def _make_legacy(path: Path) -> None:
    conn = sqlite3.connect(str(path))
    conn.execute(
        "CREATE TABLE sl_metrics (id TEXT PRIMARY KEY, sector_id TEXT, name TEXT,"
        " is_builtin INTEGER DEFAULT 0)"
    )
    conn.execute(
        "INSERT INTO sl_metrics (id, sector_id, name, is_builtin)"
        " VALUES ('m-legacy', 'manufacturing', 'Legacy Metric', 0)"
    )
    conn.commit()
    conn.close()


def test_schema_created_under_data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FRA_DATA_DIR", str(tmp_path / "data"))
    conn = get_definitions_connection()
    try:
        for table in ("sl_metrics", "sl_hierarchies", "sl_segments"):
            assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] >= 0
    finally:
        conn.close()
    assert (tmp_path / "data" / "definitions.db").exists()


def test_legacy_migration_once_and_no_resurrection(tmp_path, monkeypatch):
    import app.database as database

    monkeypatch.setenv("FRA_DATA_DIR", str(tmp_path / "data"))
    legacy = tmp_path / "legacy.db"
    _make_legacy(legacy)
    monkeypatch.setattr(database, "DB_PATH", legacy)

    # First open migrates the legacy row.
    conn = get_definitions_connection()
    try:
        row = conn.execute("SELECT name FROM sl_metrics WHERE id='m-legacy'").fetchone()
        assert row is not None and row["name"] == "Legacy Metric"
        # User deletes it.
        conn.execute("DELETE FROM sl_metrics WHERE id='m-legacy'")
        conn.commit()
    finally:
        conn.close()

    # Later boots must NOT resurrect it (flag persisted in the new DB).
    conn = get_definitions_connection()
    try:
        assert (
            conn.execute("SELECT 1 FROM sl_metrics WHERE id='m-legacy'").fetchone()
            is None
        )
    finally:
        conn.close()


def test_missing_legacy_is_fine(tmp_path, monkeypatch):
    import app.database as database

    monkeypatch.setenv("FRA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "does-not-exist.db")
    conn = get_definitions_connection()
    try:
        conn.execute(
            "INSERT INTO sl_metrics (id, sector_id, name) VALUES ('m1', 's', 'M')"
        )
        conn.commit()
        assert conn.execute("SELECT COUNT(*) FROM sl_metrics").fetchone()[0] == 1
    finally:
        conn.close()
