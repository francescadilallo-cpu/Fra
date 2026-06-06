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
