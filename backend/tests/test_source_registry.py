"""Unit tests for SourceRegistry — connectors/source_registry.py.

Uses a tmp_path fixture so no real DB is touched and the process-wide
singleton is not polluted between tests.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.connectors.source_registry import SourceConfig, SourceRegistry


@pytest.fixture()
def reg(tmp_path) -> SourceRegistry:
    return SourceRegistry(db_path=tmp_path / "registry.db")


def _cfg(id: str = "src-1", connector_type: str = "csv", label: str = "Test", **kw) -> SourceConfig:
    return SourceConfig(id=id, connector_type=connector_type, label=label, **kw)


# ── Basics ─────────────────────────────────────────────────────────────────────


class TestBasicCRUD:
    def test_empty_registry_count_is_zero(self, reg):
        assert reg.count() == 0

    def test_upsert_and_get(self, reg):
        cfg = _cfg("s1", label="Source One")
        reg.upsert(cfg)
        result = reg.get("s1")
        assert result is not None
        assert result.label == "Source One"

    def test_get_missing_returns_none(self, reg):
        assert reg.get("ghost") is None

    def test_upsert_increments_count(self, reg):
        reg.upsert(_cfg("a"))
        reg.upsert(_cfg("b"))
        assert reg.count() == 2

    def test_upsert_overwrites_existing(self, reg):
        reg.upsert(_cfg("s1", label="Old"))
        reg.upsert(_cfg("s1", label="New"))
        assert reg.get("s1").label == "New"
        assert reg.count() == 1

    def test_list_returns_all(self, reg):
        reg.upsert(_cfg("a"))
        reg.upsert(_cfg("b"))
        reg.upsert(_cfg("c"))
        ids = {s.id for s in reg.list()}
        assert ids == {"a", "b", "c"}

    def test_list_empty(self, reg):
        assert reg.list() == []


# ── SourceConfig fields ────────────────────────────────────────────────────────


class TestSourceConfigPersistence:
    def test_params_serialized_as_json(self, reg):
        params = {"host": "localhost", "port": 5432, "db": "mydb"}
        reg.upsert(_cfg("s1", params=params))
        result = reg.get("s1")
        assert result.params == params

    def test_target_tables_serialized_as_json(self, reg):
        tables = ["orders", "customers", "products"]
        reg.upsert(_cfg("s1", target_tables=tables))
        assert reg.get("s1").target_tables == tables

    def test_status_persisted(self, reg):
        reg.upsert(_cfg("s1", status="active"))
        assert reg.get("s1").status == "active"

    def test_row_count_persisted(self, reg):
        reg.upsert(_cfg("s1", row_count=1234))
        assert reg.get("s1").row_count == 1234

    def test_error_msg_persisted(self, reg):
        reg.upsert(_cfg("s1", error_msg="connection refused"))
        assert reg.get("s1").error_msg == "connection refused"

    def test_is_default_persisted(self, reg):
        reg.upsert(_cfg("s1", is_default=True))
        assert reg.get("s1").is_default is True

    def test_empty_params_defaults_to_dict(self, reg):
        reg.upsert(_cfg("s1"))
        assert reg.get("s1").params == {}

    def test_empty_target_tables_defaults_to_list(self, reg):
        reg.upsert(_cfg("s1"))
        assert reg.get("s1").target_tables == []


# ── patch ──────────────────────────────────────────────────────────────────────


class TestPatch:
    def test_patch_status(self, reg):
        reg.upsert(_cfg("s1", status="pending"))
        reg.patch("s1", status="active")
        assert reg.get("s1").status == "active"

    def test_patch_row_count(self, reg):
        reg.upsert(_cfg("s1", row_count=0))
        reg.patch("s1", row_count=500)
        assert reg.get("s1").row_count == 500

    def test_patch_returns_updated_config(self, reg):
        reg.upsert(_cfg("s1", status="pending"))
        result = reg.patch("s1", status="active")
        assert result.status == "active"

    def test_patch_missing_raises_key_error(self, reg):
        with pytest.raises(KeyError):
            reg.patch("ghost", status="active")

    def test_patch_preserves_unchanged_fields(self, reg):
        reg.upsert(_cfg("s1", label="Keep Me", row_count=99))
        reg.patch("s1", status="active")
        cfg = reg.get("s1")
        assert cfg.label == "Keep Me"
        assert cfg.row_count == 99

    def test_patch_ignores_unknown_keys(self, reg):
        reg.upsert(_cfg("s1"))
        # nonexistent attribute — should not crash
        reg.patch("s1", nonexistent_field="value")


# ── remove ─────────────────────────────────────────────────────────────────────


class TestRemove:
    def test_remove_decrements_count(self, reg):
        reg.upsert(_cfg("s1"))
        reg.upsert(_cfg("s2"))
        reg.remove("s1")
        assert reg.count() == 1

    def test_remove_makes_get_return_none(self, reg):
        reg.upsert(_cfg("s1"))
        reg.remove("s1")
        assert reg.get("s1") is None

    def test_remove_missing_raises_key_error(self, reg):
        with pytest.raises(KeyError):
            reg.remove("ghost")

    def test_remove_default_source_raises_value_error(self, reg):
        reg.upsert(_cfg("built-in", is_default=True))
        with pytest.raises(ValueError, match="default"):
            reg.remove("built-in")

    def test_remove_non_default_succeeds(self, reg):
        reg.upsert(_cfg("s1", is_default=False))
        reg.remove("s1")
        assert reg.get("s1") is None


# ── list ordering ──────────────────────────────────────────────────────────────


class TestListOrdering:
    def test_default_sources_listed_first(self, reg):
        reg.upsert(_cfg("normal", is_default=False, label="Normal"))
        reg.upsert(_cfg("builtin", is_default=True, label="Builtin"))
        sources = reg.list()
        assert sources[0].id == "builtin"
