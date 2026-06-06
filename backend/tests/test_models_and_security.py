"""Unit tests for app/models.py (Pydantic validators) and the
_safe_data_path security guard in connectors/duckdb_source_manager.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.connectors.duckdb_source_manager import _safe_data_path
from app.models import (
    AskRequest,
    HierarchyCreate,
    MappingEntry,
    MappingUpdateRequest,
    MetricCreate,
    SegmentCreate,
)


# ── _safe_data_path ────────────────────────────────────────────────────────────


class TestSafeDataPath:
    def test_normal_path_allowed(self, tmp_path):
        p = tmp_path / "data.csv"
        result = _safe_data_path(str(p))
        assert result == p.resolve()

    def test_etc_blocked(self):
        with pytest.raises(ValueError, match="restricted"):
            _safe_data_path("/etc/passwd")

    def test_proc_blocked(self):
        with pytest.raises(ValueError, match="restricted"):
            _safe_data_path("/proc/1/environ")

    def test_sys_blocked(self):
        with pytest.raises(ValueError, match="restricted"):
            _safe_data_path("/sys/kernel/kptr_restrict")

    def test_dev_blocked(self):
        with pytest.raises(ValueError, match="restricted"):
            _safe_data_path("/dev/mem")

    def test_run_blocked(self):
        with pytest.raises(ValueError, match="restricted"):
            _safe_data_path("/run/secrets/token")

    def test_boot_blocked(self):
        with pytest.raises(ValueError, match="restricted"):
            _safe_data_path("/boot/vmlinuz")

    def test_etc_traversal_blocked(self):
        with pytest.raises(ValueError, match="restricted"):
            _safe_data_path("/tmp/../etc/passwd")

    def test_returns_path_object(self, tmp_path):
        result = _safe_data_path(str(tmp_path))
        assert isinstance(result, Path)

    def test_resolves_symlink_equivalent(self, tmp_path):
        sub = tmp_path / "subdir"
        sub.mkdir()
        result = _safe_data_path(str(sub / ".." / "subdir" / "file.csv"))
        assert result == (sub / "file.csv").resolve()


# ── AskRequest ─────────────────────────────────────────────────────────────────


class TestAskRequest:
    def test_minimal_valid(self):
        r = AskRequest(question="Quanti ordini?")
        assert r.question == "Quanti ordini?"
        assert r.sector_id == "manufacturing"

    def test_custom_sector(self):
        r = AskRequest(question="Revenue?", sector_id="retail")
        assert r.sector_id == "retail"

    def test_empty_question_raises(self):
        with pytest.raises(ValidationError):
            AskRequest(question="")

    def test_question_too_long_raises(self):
        with pytest.raises(ValidationError):
            AskRequest(question="x" * 2001)

    def test_sector_id_too_long_raises(self):
        with pytest.raises(ValidationError):
            AskRequest(question="Hello?", sector_id="x" * 65)


# ── MetricCreate ───────────────────────────────────────────────────────────────


class TestMetricCreate:
    def test_minimal_valid(self):
        m = MetricCreate(name="revenue")
        assert m.name == "revenue"
        assert m.type == "sum"
        assert m.format == "number"
        assert m.status == "draft"

    def test_all_valid_types(self):
        for t in ("sum", "count", "count_distinct", "avg", "ratio", "derived"):
            m = MetricCreate(name="m", type=t)
            assert m.type == t

    def test_invalid_type_raises(self):
        with pytest.raises(ValidationError):
            MetricCreate(name="m", type="min")

    def test_valid_formats(self):
        for fmt in ("number", "currency", "percentage"):
            m = MetricCreate(name="m", format=fmt)
            assert m.format == fmt

    def test_invalid_format_raises(self):
        with pytest.raises(ValidationError):
            MetricCreate(name="m", format="integer")

    def test_valid_statuses(self):
        for s in ("draft", "verified"):
            m = MetricCreate(name="m", status=s)
            assert m.status == s

    def test_invalid_status_raises(self):
        with pytest.raises(ValidationError):
            MetricCreate(name="m", status="published")

    def test_name_empty_raises(self):
        with pytest.raises(ValidationError):
            MetricCreate(name="")

    def test_name_too_long_raises(self):
        with pytest.raises(ValidationError):
            MetricCreate(name="x" * 129)

    def test_default_grains(self):
        m = MetricCreate(name="m")
        assert m.grains == ["month", "quarter", "year"]

    def test_tags_and_filters_default_empty(self):
        m = MetricCreate(name="m")
        assert m.tags == []
        assert m.filters == []


# ── HierarchyCreate ────────────────────────────────────────────────────────────


class TestHierarchyCreate:
    def test_minimal_valid(self):
        h = HierarchyCreate(name="date")
        assert h.name == "date"
        assert h.type == "categorical"
        assert h.sector_id == "manufacturing"

    def test_time_type(self):
        h = HierarchyCreate(name="date", type="time")
        assert h.type == "time"

    def test_invalid_type_raises(self):
        with pytest.raises(ValidationError):
            HierarchyCreate(name="h", type="ordinal")

    def test_name_empty_raises(self):
        with pytest.raises(ValidationError):
            HierarchyCreate(name="")

    def test_levels_default_empty(self):
        h = HierarchyCreate(name="h")
        assert h.levels == []


# ── SegmentCreate ──────────────────────────────────────────────────────────────


class TestSegmentCreate:
    def test_minimal_valid(self):
        s = SegmentCreate(name="online")
        assert s.name == "online"
        assert s.conditions == []
        assert s.tags == []
        assert s.used_by == []

    def test_name_empty_raises(self):
        with pytest.raises(ValidationError):
            SegmentCreate(name="")

    def test_name_too_long_raises(self):
        with pytest.raises(ValidationError):
            SegmentCreate(name="x" * 129)

    def test_description_too_long_raises(self):
        with pytest.raises(ValidationError):
            SegmentCreate(name="s", description="x" * 1001)


# ── MappingEntry & MappingUpdateRequest ────────────────────────────────────────


class TestMappingModels:
    def test_mapping_entry_fields(self):
        e = MappingEntry(
            table="orders",
            field="status",
            ontology_class="Order",
            ontology_property="orderStatus",
            field_type="string",
        )
        assert e.table == "orders"
        assert e.ontology_class == "Order"

    def test_mapping_update_request_fields(self):
        r = MappingUpdateRequest(
            table="customers", field="name", ontology_path="Customer.fullName"
        )
        assert r.table == "customers"
        assert r.ontology_path == "Customer.fullName"
