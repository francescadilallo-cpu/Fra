"""Tests for DuckDB-native (streaming) file ingestion in DuckDBSourceManager.

CSV files and top-level-array JSON are ingested via DuckDB's native readers
(read_csv_auto / read_json_auto) instead of being materialised through pandas.
These tests verify the data lands correctly and the special cases (inline CSV,
records_key JSON) still work.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import duckdb

import app.connectors.duckdb_source_manager as dsm
from app.connectors.duckdb_source_manager import DuckDBSourceManager
from app.connectors.source_registry import SourceConfig, SourceRegistry


@pytest.fixture()
def mgr_env(monkeypatch, tmp_path):
    monkeypatch.setenv("FRA_STORAGE_MODE", "snapshot")
    scenario = tmp_path / "scenario"
    scenario.mkdir()
    registry = SourceRegistry(tmp_path / "registry.db")
    db_path = tmp_path / "snapshot.duckdb"
    return scenario, registry, db_path, tmp_path


class TestNativeCsv:
    def test_csv_file_ingested_via_native_reader(self, mgr_env):
        scenario, registry, db_path, tmp = mgr_env
        csv = tmp / "data.csv"
        csv.write_text("id,name,amount\n1,alpha,10\n2,beta,20\n", encoding="utf-8")
        registry.upsert(
            SourceConfig(
                id="s1",
                connector_type="csv",
                label="CSV",
                params={"path": str(csv), "table_name": "t", "delimiter": ","},
                target_tables=["t"],
            )
        )
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        counts = mgr.rebuild()
        assert counts["s1.t"] == 2
        rows = mgr.execute("SELECT name, amount FROM t ORDER BY id")
        assert rows[0]["name"] == "alpha"
        assert rows[0]["amount"] == 10  # DuckDB infers numeric type

    def test_csv_semicolon_delimiter(self, mgr_env):
        scenario, registry, db_path, tmp = mgr_env
        csv = tmp / "data.csv"
        csv.write_text("id;label\n1;x\n2;y\n3;z\n", encoding="utf-8")
        registry.upsert(
            SourceConfig(
                id="s1",
                connector_type="csv",
                label="CSV",
                params={"path": str(csv), "table_name": "t", "delimiter": ";"},
                target_tables=["t"],
            )
        )
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        counts = mgr.rebuild()
        assert counts["s1.t"] == 3

    def test_inline_csv_still_works(self, mgr_env):
        scenario, registry, db_path, tmp = mgr_env
        registry.upsert(
            SourceConfig(
                id="s1",
                connector_type="csv",
                label="CSV",
                params={"inline_csv": "id,name\n1,foo\n2,bar\n", "table_name": "t"},
                target_tables=["t"],
            )
        )
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        counts = mgr.rebuild()
        assert counts["s1.t"] == 2

    def test_csv_missing_file_raises_or_errors(self, mgr_env):
        scenario, registry, db_path, tmp = mgr_env
        registry.upsert(
            SourceConfig(
                id="s1",
                connector_type="csv",
                label="CSV",
                params={"path": str(tmp / "nope.csv"), "table_name": "t"},
                target_tables=["t"],
            )
        )
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        # Source errors are captured per-source; the table simply isn't created.
        mgr.rebuild()
        cfg = registry.get("s1")
        assert cfg is not None
        assert cfg.status == "error"


class TestNativeJson:
    def test_top_level_array_native(self, mgr_env):
        scenario, registry, db_path, tmp = mgr_env
        j = tmp / "data.json"
        j.write_text(
            json.dumps([{"id": 1, "name": "a"}, {"id": 2, "name": "b"}]),
            encoding="utf-8",
        )
        registry.upsert(
            SourceConfig(
                id="s1",
                connector_type="json",
                label="JSON",
                params={"path": str(j), "table_name": "t"},
                target_tables=["t"],
            )
        )
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        counts = mgr.rebuild()
        assert counts["s1.t"] == 2
        rows = mgr.execute("SELECT name FROM t ORDER BY id")
        assert [r["name"] for r in rows] == ["a", "b"]

    def test_records_key_uses_pandas_path(self, mgr_env):
        scenario, registry, db_path, tmp = mgr_env
        j = tmp / "data.json"
        j.write_text(
            json.dumps({"items": [{"id": 1, "name": "a"}, {"id": 2, "name": "b"}]}),
            encoding="utf-8",
        )
        registry.upsert(
            SourceConfig(
                id="s1",
                connector_type="json",
                label="JSON",
                params={"path": str(j), "table_name": "t", "records_key": "items"},
                target_tables=["t"],
            )
        )
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        counts = mgr.rebuild()
        assert counts["s1.t"] == 2


# ── Chunked DB-API cursor streaming (SQLite / PostgreSQL ingest) ───────────────


class FakeCursor:
    """Minimal DB-API cursor backed by an in-memory row list."""

    def __init__(self, rows: list[dict], description: list[tuple]):
        self._rows = list(rows)
        self.description = description

    def fetchmany(self, n: int) -> list[dict]:
        out, self._rows = self._rows[:n], self._rows[n:]
        return out


class TestStreamCursorIntoTable:
    def _mgr(self, mgr_env) -> DuckDBSourceManager:
        scenario, registry, db_path, _tmp = mgr_env
        return DuckDBSourceManager(scenario, db_path, registry)

    def test_multi_chunk_assembly(self, mgr_env, monkeypatch):
        monkeypatch.setattr(dsm, "_INGEST_CHUNK_ROWS", 7)
        mgr = self._mgr(mgr_env)
        conn = duckdb.connect()
        rows = [{"id": i, "v": f"r{i}"} for i in range(20)]
        cur = FakeCursor(rows, [("id",), ("v",)])
        n, truncated = mgr._stream_cursor_into_table(conn, cur, "t")
        assert (n, truncated) == (20, False)
        assert conn.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 20
        assert conn.execute("SELECT v FROM t WHERE id=13").fetchone()[0] == "r13"

    def test_row_limit_truncates_and_reports(self, mgr_env, monkeypatch):
        monkeypatch.setattr(dsm, "_INGEST_CHUNK_ROWS", 4)
        mgr = self._mgr(mgr_env)
        conn = duckdb.connect()
        rows = [{"id": i} for i in range(25)]
        cur = FakeCursor(rows, [("id",)])
        n, truncated = mgr._stream_cursor_into_table(conn, cur, "t", row_limit=10)
        assert (n, truncated) == (10, True)
        assert conn.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 10

    def test_limit_exactly_on_chunk_boundary(self, mgr_env, monkeypatch):
        # The +1 sentinel row arrives in its own (then fully trimmed) chunk —
        # must not attempt to INSERT an empty DataFrame.
        monkeypatch.setattr(dsm, "_INGEST_CHUNK_ROWS", 5)
        mgr = self._mgr(mgr_env)
        conn = duckdb.connect()
        rows = [{"id": i} for i in range(11)]
        cur = FakeCursor(rows, [("id",)])
        n, truncated = mgr._stream_cursor_into_table(conn, cur, "t", row_limit=10)
        assert (n, truncated) == (10, True)
        assert conn.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 10

    def test_empty_cursor_creates_empty_table_with_columns(self, mgr_env):
        mgr = self._mgr(mgr_env)
        conn = duckdb.connect()
        cur = FakeCursor([], [("a",), ("b",)])
        n, truncated = mgr._stream_cursor_into_table(conn, cur, "t")
        assert (n, truncated) == (0, False)
        cols = [d[0] for d in conn.execute("SELECT * FROM t").description]
        assert cols == ["a", "b"]
        assert conn.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 0

    def test_sqlite_source_streams_in_chunks(self, mgr_env, monkeypatch):
        import sqlite3

        monkeypatch.setattr(dsm, "_INGEST_CHUNK_ROWS", 7)
        scenario, registry, db_path, tmp = mgr_env
        src_db = tmp / "src.db"
        sconn = sqlite3.connect(str(src_db))
        sconn.execute("CREATE TABLE items (id INTEGER, name TEXT)")
        sconn.executemany(
            "INSERT INTO items VALUES (?, ?)", [(i, f"n{i}") for i in range(20)]
        )
        sconn.commit()
        sconn.close()
        registry.upsert(
            SourceConfig(
                id="s1",
                connector_type="sqlite",
                label="SQLite",
                params={"path": str(src_db)},
                target_tables=[],
            )
        )
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        counts = mgr.rebuild()
        assert counts["s1.items"] == 20
        rows = mgr.execute("SELECT name FROM items WHERE id = 13")
        assert rows[0]["name"] == "n13"


# ── get_schema_info memoisation ────────────────────────────────────────────────


class TestSchemaInfoCache:
    def _mgr_with_csv(self, mgr_env) -> DuckDBSourceManager:
        scenario, registry, db_path, tmp = mgr_env
        csv = tmp / "data.csv"
        csv.write_text("id,name\n1,a\n2,b\n", encoding="utf-8")
        registry.upsert(
            SourceConfig(
                id="s1",
                connector_type="csv",
                label="CSV",
                params={"path": str(csv), "table_name": "t"},
                target_tables=["t"],
            )
        )
        return DuckDBSourceManager(scenario, db_path, registry)

    def test_repeated_calls_return_cached_object(self, mgr_env):
        mgr = self._mgr_with_csv(mgr_env)
        first = mgr.get_schema_info()
        second = mgr.get_schema_info()
        assert first is second
        assert first["t"]["row_count"] == 2

    def test_rebuild_invalidates_cache(self, mgr_env):
        mgr = self._mgr_with_csv(mgr_env)
        first = mgr.get_schema_info()
        mgr.rebuild()
        second = mgr.get_schema_info()
        assert first is not second
        assert second["t"]["row_count"] == 2

    def test_ingest_one_invalidates_cache(self, mgr_env):
        scenario, registry, db_path, tmp = mgr_env
        mgr = self._mgr_with_csv(mgr_env)
        mgr.get_schema_info()
        # Grow the source file, re-ingest just that source, and confirm the
        # schema info reflects the new row count (not the cached one).
        (tmp / "data.csv").write_text("id,name\n1,a\n2,b\n3,c\n", encoding="utf-8")
        mgr.ingest_one("s1")
        assert mgr.get_schema_info()["t"]["row_count"] == 3
