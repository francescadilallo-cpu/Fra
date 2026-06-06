"""Tests for DuckDBSourceManager.execute() row-limiting and NULL handling.

execute() is the "frontend query" path (used by the semantic layer, LLM-SQL
fallback, and /api/data/{table}): it must cap how many rows it returns
*without* materialising the full result set first, since a query without a
LIMIT clause against a large table would otherwise be pulled entirely into
memory just to be truncated to a handful of rows afterwards. It must also
hand back SQL NULLs as native ``None`` (not pandas ``NaN``, which is not
valid JSON and behaves differently from None in truthiness/equality checks).
"""

from __future__ import annotations

import math
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


def _csv_source(sid: str, path: Path, table: str) -> SourceConfig:
    return SourceConfig(
        id=sid,
        connector_type="csv",
        label=sid,
        params={"path": str(path), "table_name": table, "delimiter": ","},
        target_tables=[table],
    )


class TestExecuteRowLimit:
    def test_default_limit_is_100_rows(self, mgr_env):
        scenario, registry, db_path, tmp = mgr_env
        csv = tmp / "big.csv"
        lines = ["id"] + [str(i) for i in range(500)]
        csv.write_text("\n".join(lines) + "\n", encoding="utf-8")
        registry.upsert(_csv_source("s1", csv, "big"))
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        mgr.rebuild()

        rows = mgr.execute("SELECT id FROM big ORDER BY id")
        assert len(rows) == 100
        assert rows[0]["id"] == 0
        assert rows[-1]["id"] == 99

    def test_custom_limit_is_respected(self, mgr_env):
        scenario, registry, db_path, tmp = mgr_env
        csv = tmp / "big.csv"
        lines = ["id"] + [str(i) for i in range(50)]
        csv.write_text("\n".join(lines) + "\n", encoding="utf-8")
        registry.upsert(_csv_source("s1", csv, "big"))
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        mgr.rebuild()

        rows = mgr.execute("SELECT id FROM big ORDER BY id", limit=5)
        assert [r["id"] for r in rows] == [0, 1, 2, 3, 4]

    def test_does_not_truncate_short_results(self, mgr_env):
        scenario, registry, db_path, tmp = mgr_env
        csv = tmp / "small.csv"
        csv.write_text("id,name\n1,alpha\n2,beta\n", encoding="utf-8")
        registry.upsert(_csv_source("s1", csv, "small"))
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        mgr.rebuild()

        rows = mgr.execute("SELECT * FROM small ORDER BY id")
        assert len(rows) == 2


class TestExecuteNullHandling:
    def test_null_values_come_back_as_none_not_nan(self, mgr_env):
        scenario, registry, db_path, tmp = mgr_env
        csv = tmp / "withnull.csv"
        csv.write_text("id,amount,label\n1,10.5,a\n2,,\n3,30.5,c\n", encoding="utf-8")
        registry.upsert(_csv_source("s1", csv, "withnull"))
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        mgr.rebuild()

        rows = mgr.execute("SELECT id, amount, label FROM withnull ORDER BY id")
        assert rows[1]["amount"] is None
        assert rows[1]["label"] is None
        # Not NaN: NaN survives `is None` checks as False and is truthy,
        # which breaks `value or default`-style fallbacks downstream.
        assert not (
            isinstance(rows[1]["amount"], float) and math.isnan(rows[1]["amount"])
        )

    def test_params_variant_also_returns_none_for_null(self, mgr_env):
        scenario, registry, db_path, tmp = mgr_env
        csv = tmp / "withnull.csv"
        csv.write_text("id,amount\n1,10.5\n2,\n", encoding="utf-8")
        registry.upsert(_csv_source("s1", csv, "withnull"))
        mgr = DuckDBSourceManager(scenario, db_path, registry)
        mgr.rebuild()

        rows = mgr.execute("SELECT id, amount FROM withnull WHERE id = ?", params=(2,))
        assert rows[0]["amount"] is None
