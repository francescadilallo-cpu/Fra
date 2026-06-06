"""Unit tests for semantic/templates.py — QueryTemplateCreate and QueryTemplateUpdate."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.semantic.templates import QueryTemplateCreate, QueryTemplateUpdate


# ── QueryTemplateCreate ────────────────────────────────────────────────────────


class TestQueryTemplateCreate:
    def test_minimal_valid(self):
        t = QueryTemplateCreate(
            name="Revenue by year",
            sql_query="SELECT SUM(total) FROM orders WHERE year = {year}",
        )
        assert t.name == "Revenue by year"
        assert t.keywords == []
        assert t.sources == []

    def test_allowed_year_token(self):
        t = QueryTemplateCreate(
            name="T1",
            sql_query="SELECT * FROM orders WHERE yr = {year}",
        )
        assert "{year}" in t.sql_query

    def test_allowed_limit_token(self):
        t = QueryTemplateCreate(
            name="T1",
            sql_query="SELECT * FROM orders LIMIT {limit}",
        )
        assert "{limit}" in t.sql_query

    def test_both_tokens_allowed(self):
        t = QueryTemplateCreate(
            name="T1",
            sql_query="SELECT * FROM orders WHERE yr={year} LIMIT {limit}",
        )
        assert t is not None

    def test_no_tokens_allowed(self):
        t = QueryTemplateCreate(name="T1", sql_query="SELECT COUNT(*) FROM orders")
        assert t is not None

    def test_forbidden_token_raises(self):
        with pytest.raises(ValidationError, match="Unsupported template tokens"):
            QueryTemplateCreate(
                name="T1",
                sql_query="SELECT * FROM orders WHERE x = {month}",
            )

    def test_multiple_forbidden_tokens_raises(self):
        with pytest.raises(ValidationError, match="Unsupported template tokens"):
            QueryTemplateCreate(
                name="T1",
                sql_query="SELECT * FROM t WHERE a={foo} AND b={bar}",
            )

    def test_name_too_short_raises(self):
        with pytest.raises(ValidationError):
            QueryTemplateCreate(name="", sql_query="SELECT COUNT(*) FROM orders")

    def test_name_too_long_raises(self):
        with pytest.raises(ValidationError):
            QueryTemplateCreate(name="x" * 201, sql_query="SELECT COUNT(*) FROM orders")

    def test_sql_too_short_raises(self):
        with pytest.raises(ValidationError):
            QueryTemplateCreate(name="T1", sql_query="SELECT 1")

    def test_sql_too_long_raises(self):
        with pytest.raises(ValidationError):
            QueryTemplateCreate(name="T1", sql_query="SELECT " + "x" * 8000)

    def test_keywords_stored(self):
        t = QueryTemplateCreate(
            name="T1",
            sql_query="SELECT COUNT(*) FROM orders",
            keywords=["ordini", "conteggio"],
        )
        assert t.keywords == ["ordini", "conteggio"]

    def test_sources_stored(self):
        t = QueryTemplateCreate(
            name="T1",
            sql_query="SELECT COUNT(*) FROM orders",
            sources=["erp"],
        )
        assert t.sources == ["erp"]

    def test_description_stored(self):
        t = QueryTemplateCreate(
            name="T1",
            sql_query="SELECT COUNT(*) FROM orders",
            description="Count of all orders",
        )
        assert t.description == "Count of all orders"

    def test_description_too_long_raises(self):
        with pytest.raises(ValidationError):
            QueryTemplateCreate(
                name="T1",
                sql_query="SELECT COUNT(*) FROM orders",
                description="x" * 2001,
            )


# ── QueryTemplateUpdate ────────────────────────────────────────────────────────


class TestQueryTemplateUpdate:
    def test_all_fields_optional(self):
        u = QueryTemplateUpdate()
        assert u.name is None
        assert u.sql_query is None
        assert u.description is None
        assert u.keywords is None
        assert u.sources is None

    def test_partial_update_name(self):
        u = QueryTemplateUpdate(name="New Name")
        assert u.name == "New Name"

    def test_partial_update_sql(self):
        u = QueryTemplateUpdate(sql_query="SELECT COUNT(*) FROM orders")
        assert u.sql_query is not None

    def test_sql_with_allowed_token(self):
        u = QueryTemplateUpdate(sql_query="SELECT * FROM t WHERE yr = {year}")
        assert u.sql_query is not None

    def test_sql_with_forbidden_token_raises(self):
        with pytest.raises(ValidationError, match="Unsupported template tokens"):
            QueryTemplateUpdate(sql_query="SELECT * FROM t WHERE x = {quarter}")

    def test_sql_none_skips_token_validation(self):
        u = QueryTemplateUpdate(name="Rename only")
        assert u.sql_query is None  # no validation error

    def test_name_min_length(self):
        with pytest.raises(ValidationError):
            QueryTemplateUpdate(name="")

    def test_name_max_length(self):
        with pytest.raises(ValidationError):
            QueryTemplateUpdate(name="x" * 201)
