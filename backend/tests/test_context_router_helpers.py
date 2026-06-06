"""Unit tests for context/router.py — _extract_text helper and Pydantic models."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.context.router import (
    EntityIn,
    GlossaryIn,
    MetricIn,
    _MAX_UPLOAD_BYTES,
    _extract_text,
)


# ── _extract_text ──────────────────────────────────────────────────────────────


class TestExtractText:
    def test_plain_text_utf8(self):
        content = "Hello, world!"
        result = _extract_text(content.encode("utf-8"), "note.txt")
        assert result == "Hello, world!"

    def test_markdown_content(self):
        content = "# Title\n\nSome **bold** text."
        result = _extract_text(content.encode("utf-8"), "doc.md")
        assert "Title" in result

    def test_non_utf8_bytes_decoded_with_replace(self):
        # Bytes that are not valid UTF-8 — should not raise
        result = _extract_text(b"\xff\xfe hello", "binary.bin")
        assert isinstance(result, str)

    def test_empty_bytes_returns_empty_string(self):
        result = _extract_text(b"", "empty.txt")
        assert result == ""

    def test_non_pdf_uses_utf8_decode(self):
        content = "Revenue: 100"
        result = _extract_text(content.encode("utf-8"), "report.txt")
        assert result == "Revenue: 100"

    def test_csv_content(self):
        content = "id,name,amount\n1,Acme,100\n2,Beta,200"
        result = _extract_text(content.encode("utf-8"), "data.csv")
        assert "Acme" in result


# ── MAX_UPLOAD_BYTES ────────────────────────────────────────────────────────────


class TestMaxUploadBytes:
    def test_limit_is_2mb(self):
        assert _MAX_UPLOAD_BYTES == 2 * 1024 * 1024


# ── EntityIn ───────────────────────────────────────────────────────────────────


class TestEntityIn:
    def test_minimal_valid(self):
        e = EntityIn(name="Customer", display_name="Customer")
        assert e.name == "Customer"
        assert e.synonyms == []
        assert e.description == ""
        assert e.source == ""

    def test_with_all_fields(self):
        e = EntityIn(
            name="Customer",
            display_name="Cliente",
            synonyms=["client", "buyer"],
            description="A buying party",
            source="crm",
        )
        assert e.synonyms == ["client", "buyer"]
        assert e.source == "crm"

    def test_name_too_short_raises(self):
        with pytest.raises(ValidationError):
            EntityIn(name="", display_name="X")

    def test_name_too_long_raises(self):
        with pytest.raises(ValidationError):
            EntityIn(name="x" * 129, display_name="X")

    def test_display_name_too_long_raises(self):
        with pytest.raises(ValidationError):
            EntityIn(name="Customer", display_name="x" * 129)

    def test_description_too_long_raises(self):
        with pytest.raises(ValidationError):
            EntityIn(name="C", display_name="C", description="x" * 1001)

    def test_source_too_long_raises(self):
        with pytest.raises(ValidationError):
            EntityIn(name="C", display_name="C", source="x" * 257)


# ── MetricIn ───────────────────────────────────────────────────────────────────


class TestMetricIn:
    def test_minimal_valid(self):
        m = MetricIn(name="revenue", display_name="Revenue")
        assert m.name == "revenue"
        assert m.certified is False
        assert m.unit == ""

    def test_certified_true(self):
        m = MetricIn(name="m", display_name="M", certified=True)
        assert m.certified is True

    def test_name_too_short_raises(self):
        with pytest.raises(ValidationError):
            MetricIn(name="", display_name="M")

    def test_name_too_long_raises(self):
        with pytest.raises(ValidationError):
            MetricIn(name="x" * 129, display_name="M")

    def test_unit_too_long_raises(self):
        with pytest.raises(ValidationError):
            MetricIn(name="m", display_name="M", unit="x" * 65)

    def test_synonyms_default_empty(self):
        m = MetricIn(name="m", display_name="M")
        assert m.synonyms == []

    def test_description_too_long_raises(self):
        with pytest.raises(ValidationError):
            MetricIn(name="m", display_name="M", description="x" * 1001)


# ── GlossaryIn ─────────────────────────────────────────────────────────────────


class TestGlossaryIn:
    def test_minimal_valid(self):
        g = GlossaryIn(term="fatturato", definition="Net revenue")
        assert g.term == "fatturato"
        assert g.definition == "Net revenue"

    def test_term_too_short_raises(self):
        with pytest.raises(ValidationError):
            GlossaryIn(term="", definition="Some definition")

    def test_term_too_long_raises(self):
        with pytest.raises(ValidationError):
            GlossaryIn(term="x" * 129, definition="d")

    def test_definition_too_short_raises(self):
        with pytest.raises(ValidationError):
            GlossaryIn(term="t", definition="")

    def test_definition_too_long_raises(self):
        with pytest.raises(ValidationError):
            GlossaryIn(term="t", definition="x" * 2001)
