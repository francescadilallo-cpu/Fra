"""Integration tests for DuckDBSourceManager incremental ingest (snapshot mode).

Verifies that ingest_one() updates only the target source's tables and leaves
every other source's data untouched, and that it falls back to a full rebuild
on error.
"""

from __future__ import annotations

import sys
import threading
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.connectors.duckdb_source_manager import DuckDBSourceManager
from app.connectors.source_registry import SourceConfig, SourceRegistry


@pytest.fixture()
def snapshot_env(monkeypatch, tmp_path):
    """Snapshot mode with an isolated registry, empty scenario dir, temp db."""
    monkeypatch.setenv("FRA_STORAGE_MODE", "snapshot")
    scenario = tmp_path / "scenario"  # empty → no auto-discovered files
    scenario.mkdir()
    registry = SourceRegistry(tmp_path / "registry.db")
    db_path = tmp_path / "snapshot.duckdb"
    return scenario, registry, db_path, tmp_path


def _write_csv(path: Path, rows: list[str]) -> None:
    path.write_text("\n".join(rows) + "\n", encoding="utf-8")


def _make_csv_source(sid: str, csv_path: Path, table: str) -> SourceConfig:
    return SourceConfig(
        id=sid,
        connector_type="csv",
        label=f"CSV {sid}",
        params={"path": str(csv_path), "table_name": table, "delimiter": ","},
        target_tables=[table],
    )


class TestIncrementalIngest:
    def test_only_target_source_is_reingested(self, snapshot_env):
        scenario, registry, db_path, tmp = snapshot_env

        a_csv = tmp / "a.csv"
        b_csv = tmp / "b.csv"
        _write_csv(a_csv, ["id,name", "1,alpha", "2,beta"])
        _write_csv(b_csv, ["id,name", "1,gamma"])
        registry.upsert(_make_csv_source("srca", a_csv, "table_a"))
        registry.upsert(_make_csv_source("srcb", b_csv, "table_b"))

        mgr = DuckDBSourceManager(scenario, db_path, registry)
        counts = mgr.rebuild()
        assert counts["srca.table_a"] == 2
        assert counts["srcb.table_b"] == 1

        # Grow source A, shrink nothing else; sync only A.
        _write_csv(a_csv, ["id,name", "1,alpha", "2,beta", "3,delta"])
        new_counts = mgr.ingest_one("srca")

        assert new_counts["srca.table_a"] == 3  # A updated
        assert new_counts["srcb.table_b"] == 1  # B untouched

        # Data is actually queryable and correct.
        rows_a = mgr.execute("SELECT COUNT(*) AS n FROM table_a")
        rows_b = mgr.execute("SELECT COUNT(*) AS n FROM table_b")
        assert rows_a[0]["n"] == 3
        assert rows_b[0]["n"] == 1

    def test_incremental_replaces_not_appends(self, snapshot_env):
        scenario, registry, db_path, tmp = snapshot_env
        a_csv = tmp / "a.csv"
        _write_csv(a_csv, ["id,name", "1,alpha", "2,beta"])
        registry.upsert(_make_csv_source("srca", a_csv, "table_a"))

        mgr = DuckDBSourceManager(scenario, db_path, registry)
        mgr.rebuild()

        # Replace contents entirely with a single different row.
        _write_csv(a_csv, ["id,name", "9,omega"])
        mgr.ingest_one("srca")

        rows = mgr.execute("SELECT id, name FROM table_a")
        assert len(rows) == 1
        assert rows[0]["name"] == "omega"

    def test_unknown_source_raises(self, snapshot_env):
        scenario, registry, db_path, tmp = snapshot_env
        a_csv = tmp / "a.csv"
        _write_csv(a_csv, ["id", "1"])
        registry.upsert(_make_csv_source("srca", a_csv, "table_a"))
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        mgr.rebuild()
        with pytest.raises(KeyError):
            mgr.ingest_one("does_not_exist")

    def test_fallback_to_rebuild_on_ingest_error(self, snapshot_env):
        scenario, registry, db_path, tmp = snapshot_env
        a_csv = tmp / "a.csv"
        _write_csv(a_csv, ["id,name", "1,alpha"])
        registry.upsert(_make_csv_source("srca", a_csv, "table_a"))
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        mgr.rebuild()

        # Delete the backing file so re-ingest raises → must fall back to a full
        # rebuild without propagating the error.
        a_csv.unlink()
        result = mgr.ingest_one("srca")
        # Full rebuild ran; the source errored but the call returned a dict.
        assert isinstance(result, dict)

    def test_registry_target_tables_persisted(self, snapshot_env):
        scenario, registry, db_path, tmp = snapshot_env
        a_csv = tmp / "a.csv"
        _write_csv(a_csv, ["id,name", "1,alpha"])
        registry.upsert(_make_csv_source("srca", a_csv, "table_a"))
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        mgr.rebuild()
        mgr.ingest_one("srca")

        cfg = registry.get("srca")
        assert cfg is not None
        assert cfg.status == "active"
        assert "table_a" in cfg.target_tables


class TestConcurrentReadDuringIncrementalSync:
    """get_connection() hands out read-only DuckDB connections to the same
    snapshot file _ingest_incremental() writes to with its own read-write
    connection. DuckDB refuses a second connection to one database file with
    a *different* configuration (read_only=True vs. the ingest's read-write
    default) while the process already holds one open — it raises
    ConnectionException immediately, it does not queue or degrade.

    rebuild() avoids this by flipping `_ready` to False first, so concurrent
    get_connection() calls funnel through _ensure_ready()'s lock and block
    until the rebuild finishes. _ingest_incremental() never touches `_ready`,
    so it stays True the whole time — every concurrent reader takes the fast
    `if self._ready: return` path in _ensure_ready(), skips the lock, and
    collides with the ingest's open write connection."""

    def test_query_does_not_crash_while_a_sync_holds_the_write_connection(
        self, snapshot_env, monkeypatch
    ):
        scenario, registry, db_path, tmp = snapshot_env
        a_csv = tmp / "a.csv"
        b_csv = tmp / "b.csv"
        _write_csv(a_csv, ["id,name", "1,alpha"])
        _write_csv(b_csv, ["id,name", "1,beta"])
        registry.upsert(_make_csv_source("srca", a_csv, "table_a"))
        registry.upsert(_make_csv_source("srcb", b_csv, "table_b"))

        mgr = DuckDBSourceManager(scenario, db_path, registry)
        mgr.rebuild()

        # Stretch the window in which _ingest_incremental's write connection
        # is open, so a concurrent read is guaranteed to land inside it.
        write_connection_open = threading.Event()
        release_write_connection = threading.Event()
        original_ingest_source = mgr._ingest_source

        def _blocking_ingest_source(conn, cfg):
            write_connection_open.set()
            release_write_connection.wait(timeout=5)
            return original_ingest_source(conn, cfg)

        monkeypatch.setattr(mgr, "_ingest_source", _blocking_ingest_source)

        sync_thread = threading.Thread(target=mgr.ingest_one, args=("srca",))
        sync_thread.start()
        try:
            assert write_connection_open.wait(timeout=5), (
                "sync never reached _ingest_source — write connection not open"
            )

            read_rows: list[dict[str, Any]] = []
            read_error: list[BaseException] = []

            def _read():
                try:
                    read_rows.extend(mgr.execute("SELECT COUNT(*) AS n FROM table_b"))
                except BaseException as exc:  # capture *any* crash, not just ours
                    read_error.append(exc)

            read_thread = threading.Thread(target=_read)
            read_thread.start()
            read_thread.join(timeout=2)
            still_running = read_thread.is_alive()
        finally:
            release_write_connection.set()
            sync_thread.join(timeout=10)

        if still_running:
            read_thread.join(timeout=10)

        assert not read_error, (
            "a query concurrent with an in-progress source sync must wait "
            "for the sync (like rebuild() makes it do) or simply succeed — "
            f"not crash: {read_error[0]!r}"
        )
        assert read_rows[0]["n"] == 1
