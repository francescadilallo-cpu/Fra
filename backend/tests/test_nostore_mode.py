"""Tests for nostore-mode behaviour of DuckDBSourceManager.

In nostore mode the unified in-memory DuckDB is built once and kept alive for
the process; get_connection() hands out cheap cursors on it instead of
re-ingesting every source on each query. Data refreshes only on an explicit
rebuild()/ingest_one().
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.connectors.duckdb_source_manager import DuckDBSourceManager
from app.connectors.source_registry import SourceConfig, SourceRegistry


@pytest.fixture()
def nostore_env(monkeypatch, tmp_path):
    monkeypatch.setenv("FRA_STORAGE_MODE", "nostore")
    scenario = tmp_path / "scenario"
    scenario.mkdir()
    registry = SourceRegistry(tmp_path / "registry.db")
    db_path = tmp_path / "unused.duckdb"
    return scenario, registry, db_path, tmp_path


def _csv_source(sid: str, path: Path, table: str) -> SourceConfig:
    return SourceConfig(
        id=sid,
        connector_type="csv",
        label=sid,
        params={"path": str(path), "table_name": table, "delimiter": ","},
        target_tables=[table],
    )


class TestNostoreMode:
    def test_queries_work(self, nostore_env):
        scenario, registry, db_path, tmp = nostore_env
        csv = tmp / "a.csv"
        csv.write_text("id,name\n1,alpha\n2,beta\n", encoding="utf-8")
        registry.upsert(_csv_source("s1", csv, "t"))
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        rows = mgr.execute("SELECT COUNT(*) AS n FROM t")
        assert rows[0]["n"] == 2

    def test_repeated_queries_reuse_same_db(self, nostore_env):
        scenario, registry, db_path, tmp = nostore_env
        csv = tmp / "a.csv"
        csv.write_text("id,name\n1,alpha\n", encoding="utf-8")
        registry.upsert(_csv_source("s1", csv, "t"))
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        mgr.execute("SELECT 1")  # triggers build
        first_conn = mgr._mem_conn
        mgr.execute("SELECT 1")
        mgr.execute("SELECT 1")
        # The in-memory database is built once and reused, not rebuilt per query.
        assert mgr._mem_conn is first_conn

    def test_no_disk_file_created(self, nostore_env):
        scenario, registry, db_path, tmp = nostore_env
        csv = tmp / "a.csv"
        csv.write_text("id\n1\n", encoding="utf-8")
        registry.upsert(_csv_source("s1", csv, "t"))
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        mgr.execute("SELECT COUNT(*) FROM t")
        # nostore must not persist a snapshot file.
        assert not db_path.exists()

    def test_rebuild_picks_up_changes(self, nostore_env):
        scenario, registry, db_path, tmp = nostore_env
        csv = tmp / "a.csv"
        csv.write_text("id,name\n1,alpha\n", encoding="utf-8")
        registry.upsert(_csv_source("s1", csv, "t"))
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        assert mgr.execute("SELECT COUNT(*) AS n FROM t")[0]["n"] == 1

        # Change the source and explicitly rebuild.
        csv.write_text("id,name\n1,alpha\n2,beta\n3,gamma\n", encoding="utf-8")
        mgr.rebuild()
        assert mgr.execute("SELECT COUNT(*) AS n FROM t")[0]["n"] == 3

    def test_cursor_independent_of_manager_close(self, nostore_env):
        # A cursor handed out by get_connection can be used then closed without
        # affecting subsequent queries.
        scenario, registry, db_path, tmp = nostore_env
        csv = tmp / "a.csv"
        csv.write_text("id\n1\n2\n", encoding="utf-8")
        registry.upsert(_csv_source("s1", csv, "t"))
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        conn = mgr.get_connection()
        assert conn.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 2
        conn.close()
        # Subsequent query still works (underlying DB still alive).
        assert mgr.execute("SELECT COUNT(*) AS n FROM t")[0]["n"] == 2
