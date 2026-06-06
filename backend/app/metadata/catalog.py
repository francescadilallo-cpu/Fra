"""MetadataCatalog — SQLAlchemy + SQLite persistence for entity/attribute/metric metadata.

Populated from connectors, the ontology, and the knowledge graph.
Every entity and attribute record stores:
  - source(s) of truth with table.column path
  - data type, nullability_rate (from actual data)
  - business_definition, freshness (timestamp), record_count, sample_values (≤5)
  - quality_flags: {duplicates_detected, null_rate_warning}
  - lineage_edges: [{metric, entity, source_field}]
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime

from sqlalchemy import Float, Integer, String, Text, create_engine, delete, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

logger = logging.getLogger(__name__)

NULL_RATE_WARN_THRESHOLD = 0.10  # warn if >10 % nulls


# ── SQLAlchemy models ─────────────────────────────────────────────────────────


class Base(DeclarativeBase):
    pass


class EntityMetaRow(Base):
    __tablename__ = "entity_meta"

    name: Mapped[str] = mapped_column(String, primary_key=True)
    description: Mapped[str | None] = mapped_column(Text, default="")
    primary_key: Mapped[str | None] = mapped_column(String, default="")
    sources_json: Mapped[str | None] = mapped_column(Text, default="[]")
    record_count: Mapped[int | None] = mapped_column(Integer, default=0)
    freshness: Mapped[str | None] = mapped_column(String, default="")
    quality_flags_json: Mapped[str | None] = mapped_column(Text, default="{}")
    kg_node_count: Mapped[int | None] = mapped_column(Integer, default=0)
    user_description: Mapped[str | None] = mapped_column(Text, default="")
    context_notes: Mapped[str | None] = mapped_column(Text, default="")


class AttributeMetaRow(Base):
    __tablename__ = "attribute_meta"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity: Mapped[str] = mapped_column(String, nullable=False)
    attribute: Mapped[str] = mapped_column(String, nullable=False)
    data_type: Mapped[str | None] = mapped_column(String, default="unknown")
    nullability_rate: Mapped[float | None] = mapped_column(Float, default=0.0)
    business_definition: Mapped[str | None] = mapped_column(Text, default="")
    source_path: Mapped[str | None] = mapped_column(String, default="")
    sample_values_json: Mapped[str | None] = mapped_column(Text, default="[]")
    lineage_edges_json: Mapped[str | None] = mapped_column(Text, default="[]")


class MetricMetaRow(Base):
    __tablename__ = "metric_meta"

    name: Mapped[str] = mapped_column(String, primary_key=True)
    label: Mapped[str | None] = mapped_column(String, default="")
    description: Mapped[str | None] = mapped_column(Text, default="")
    formula: Mapped[str | None] = mapped_column(Text, default="")
    unit: Mapped[str | None] = mapped_column(String, default="")
    aliases_json: Mapped[str | None] = mapped_column(Text, default="[]")
    requires_join_json: Mapped[str | None] = mapped_column(Text, default="[]")
    sources_touched_json: Mapped[str | None] = mapped_column(Text, default="[]")


class QueryTemplateRow(Base):
    __tablename__ = "query_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, default="")
    sql_query: Mapped[str] = mapped_column(Text, nullable=False)
    keywords_json: Mapped[str | None] = mapped_column(Text, default="[]")
    sources_json: Mapped[str | None] = mapped_column(Text, default="[]")
    created_at: Mapped[str | None] = mapped_column(String, default="")
    updated_at: Mapped[str | None] = mapped_column(String, default="")
    is_active: Mapped[int | None] = mapped_column(Integer, default=1)
    auto_generated: Mapped[int | None] = mapped_column(Integer, default=0)


class ContextDocRow(Base):
    __tablename__ = "context_docs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    content: Mapped[str | None] = mapped_column(Text, default="")
    created_at: Mapped[str | None] = mapped_column(String, default="")


# ── Pydantic-style dataclasses (returned by public API) ──────────────────────


class EntityMeta:
    """Lightweight container for entity metadata."""

    def __init__(self, row: EntityMetaRow) -> None:
        self._row = row

    @property
    def name(self) -> str:
        return self._row.name

    @property
    def description(self) -> str:
        return self._row.description or ""

    @property
    def record_count(self) -> int:
        return self._row.record_count or 0

    @property
    def freshness(self) -> str:
        return self._row.freshness or ""

    @property
    def sources(self) -> list[dict]:
        return json.loads(self._row.sources_json or "[]")

    @property
    def quality_flags(self) -> dict:
        return json.loads(self._row.quality_flags_json or "{}")

    @property
    def kg_node_count(self) -> int:
        return self._row.kg_node_count or 0

    @property
    def user_description(self) -> str:
        return getattr(self._row, "user_description", "") or ""

    @property
    def context_notes(self) -> str:
        return getattr(self._row, "context_notes", "") or ""

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "record_count": self.record_count,
            "freshness": self.freshness,
            "sources": self.sources,
            "quality_flags": self.quality_flags,
            "kg_node_count": self.kg_node_count,
        }


class AttributeMeta:
    """Lightweight container for attribute metadata."""

    def __init__(self, row: AttributeMetaRow) -> None:
        self._row = row

    @property
    def entity(self) -> str:
        return self._row.entity

    @property
    def attribute(self) -> str:
        return self._row.attribute

    @property
    def data_type(self) -> str:
        return self._row.data_type or "unknown"

    @property
    def nullability_rate(self) -> float:
        return self._row.nullability_rate or 0.0

    @property
    def business_definition(self) -> str:
        return self._row.business_definition or ""

    @property
    def source_path(self) -> str:
        return self._row.source_path or ""

    @property
    def sample_values(self) -> list:
        return json.loads(self._row.sample_values_json or "[]")

    @property
    def lineage_edges(self) -> list[dict]:
        return json.loads(self._row.lineage_edges_json or "[]")

    def to_dict(self) -> dict:
        return {
            "entity": self.entity,
            "attribute": self.attribute,
            "data_type": self.data_type,
            "nullability_rate": self.nullability_rate,
            "business_definition": self.business_definition,
            "source_path": self.source_path,
            "sample_values": self.sample_values,
            "lineage_edges": self.lineage_edges,
        }


class MetricMeta:
    """Lightweight container for metric metadata."""

    def __init__(self, row: MetricMetaRow) -> None:
        self._row = row

    @property
    def name(self) -> str:
        return self._row.name

    @property
    def label(self) -> str:
        return self._row.label or ""

    @property
    def description(self) -> str:
        return self._row.description or ""

    @property
    def formula(self) -> str:
        return self._row.formula or ""

    @property
    def unit(self) -> str:
        return self._row.unit or ""

    @property
    def aliases(self) -> list[str]:
        return json.loads(self._row.aliases_json or "[]")

    @property
    def requires_join(self) -> list[str]:
        return json.loads(self._row.requires_join_json or "[]")

    @property
    def sources_touched(self) -> list[str]:
        return json.loads(self._row.sources_touched_json or "[]")

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "description": self.description,
            "formula": self.formula,
            "unit": self.unit,
            "aliases": self.aliases,
            "requires_join": self.requires_join,
            "sources_touched": self.sources_touched,
        }


# ── MetadataCatalog ───────────────────────────────────────────────────────────


class MetadataCatalog:
    """Persists entity/attribute/metric metadata to a SQLite database.

    Parameters
    ----------
    db_url:
        SQLAlchemy database URL.  Defaults to in-memory SQLite.
    """

    def __init__(self, db_url: str = "sqlite:///:memory:") -> None:
        in_memory = ":memory:" in db_url
        engine_kwargs: dict = {"echo": False}
        if in_memory:
            engine_kwargs["connect_args"] = {"check_same_thread": False}
            engine_kwargs["poolclass"] = StaticPool
        self._engine = create_engine(db_url, **engine_kwargs)
        Base.metadata.create_all(self._engine)
        self._migrate_schema()
        self._Session = sessionmaker(bind=self._engine)
        self._populated = False
        # Cache for get_schema_context() — the schema description fed to the LLM
        # on every dynamic-SQL request. Recomputing it scans every entity and
        # attribute row plus JSON-parses sources on each call, so we memoise it
        # and invalidate only when the schema actually changes (populate /
        # populate_from_manager / prune_phantom_entities).
        self._schema_ctx_cache: dict[int, str] = {}
        self._schema_ctx_lock = threading.Lock()

    def _invalidate_schema_context_cache(self) -> None:
        """Drop the memoised schema-context strings after a schema mutation."""
        with self._schema_ctx_lock:
            self._schema_ctx_cache.clear()

    def _migrate_schema(self) -> None:
        """Add new columns to existing SQLite tables without breaking existing data."""
        import sqlite3 as _sqlite3

        url = str(self._engine.url)
        db_path = url.split("///")[-1] if "///" in url else None
        if not db_path or ":memory:" in db_path:
            return
        conn = _sqlite3.connect(db_path)
        try:
            for col, ddl in [
                ("user_description", "TEXT DEFAULT ''"),
                ("context_notes", "TEXT DEFAULT ''"),
            ]:
                try:
                    conn.execute(f"ALTER TABLE entity_meta ADD COLUMN {col} {ddl}")
                except Exception:
                    pass  # column already exists
            try:
                conn.execute(
                    "ALTER TABLE query_templates ADD COLUMN auto_generated INTEGER DEFAULT 0"
                )
            except Exception:
                pass  # column already exists
            conn.commit()
        finally:
            conn.close()

    # ── population ────────────────────────────────────────────────────────────

    def populate(self, connectors: list, ontology, kg, mgr=None) -> None:
        """Populate the catalog from connectors, ontology, and KG.

        When *mgr* is provided, all row counts and column samples are fetched
        via ``mgr.execute()`` (unified DuckDB path) so the method works even
        when the per-domain adapter methods (``load_entity``) are not available.
        The adapters are used as a fallback when *mgr* is not supplied.
        """
        logger.info("Populating metadata catalog…")
        now = datetime.utcnow().isoformat()

        with self._Session() as session:
            self._populate_metrics(session, ontology)
            self._populate_erp(session, connectors, ontology, kg, now, mgr)
            self._populate_crm(session, connectors, ontology, kg, now, mgr)
            self._populate_hr_pim(session, connectors, ontology, kg, now, mgr)
            session.commit()

        self._invalidate_schema_context_cache()
        self._populated = True
        logger.info("Metadata catalog populated.")

    def populate_from_manager(self, mgr) -> None:
        """Auto-discover all tables in the DuckDB snapshot and upsert catalog entries.

        Supplements the hardcoded populate() with schema-driven discovery so that
        any registered source — including sources added at runtime — is immediately
        visible to the semantic layer for LLM SQL generation.
        """
        try:
            schema = mgr.get_schema_info()
        except Exception as exc:
            logger.warning("populate_from_manager: schema discovery failed: %s", exc)
            return

        now = datetime.utcnow().isoformat()
        with self._Session() as session:
            for table, info in schema.items():
                columns = info.get("columns", [])
                row_count = info.get("row_count", 0)
                sample = info.get("sample", [])

                self._upsert_entity(
                    session,
                    name=table,
                    description=f"Auto-discovered from DuckDB snapshot (table: {table})",
                    primary_key="",
                    sources=[{"source": "duckdb_unified", "table": table}],
                    record_count=row_count,
                    freshness=now,
                    quality_flags={},
                    kg_node_count=0,
                )

                for col in columns:
                    col_name = col.get("name", "")
                    col_type = col.get("type", "unknown")
                    if not col_name:
                        continue
                    vals = [
                        str(r.get(col_name))
                        for r in sample
                        if r.get(col_name) is not None
                    ][:5]
                    null_rate = (
                        sum(1 for r in sample if r.get(col_name) is None) / len(sample)
                        if sample
                        else 0.0
                    )
                    self._upsert_attribute(
                        session,
                        entity=table,
                        attribute=col_name,
                        data_type=col_type,
                        nullability_rate=round(null_rate, 4),
                        business_definition="",
                        source_path=f"duckdb_unified.{table}.{col_name}",
                        sample_values=vals,
                        lineage_edges=[],
                    )
            session.commit()
        self._invalidate_schema_context_cache()
        logger.info(
            "populate_from_manager: upserted %d tables into catalog", len(schema)
        )

    def get_schema_context(self, max_tables: int = 30) -> str:
        """Return a compact LLM-ready description of all catalogued tables.

        Used in the LLM SQL-generation prompt so the model knows exactly which
        tables and columns are available in the DuckDB snapshot.

        The result is memoised per ``max_tables`` and invalidated whenever the
        schema changes, so the hot query path does not rescan every entity and
        attribute row on each request.
        """
        with self._schema_ctx_lock:
            cached = self._schema_ctx_cache.get(max_tables)
        if cached is not None:
            return cached

        result = self._compute_schema_context(max_tables)

        with self._schema_ctx_lock:
            self._schema_ctx_cache[max_tables] = result
        return result

    def _compute_schema_context(self, max_tables: int) -> str:
        with self._Session() as session:
            entity_rows = session.execute(select(EntityMetaRow)).scalars().all()
            attr_rows = session.execute(select(AttributeMetaRow)).scalars().all()

        if not entity_rows:
            return "No schema available."

        # Group attributes by entity
        attrs_by_entity: dict[str, list] = {}
        for ar in attr_rows:
            attrs_by_entity.setdefault(ar.entity, []).append(ar)

        # Deduplicate by actual DuckDB table name — prefer first occurrence
        seen_tables: set[str] = set()
        lines: list[str] = ["Available tables in DuckDB:\n"]
        count = 0

        for row in sorted(entity_rows, key=lambda r: r.name):
            if count >= max_tables:
                break
            sources = json.loads(row.sources_json or "[]")
            table = next(
                (s.get("table", row.name) for s in sources if isinstance(s, dict)),
                row.name,
            )
            if table in seen_tables:
                continue
            seen_tables.add(table)
            count += 1

            record_count = row.record_count or 0
            lines.append(f"Table: {table} ({record_count:,} rows)")
            attrs = attrs_by_entity.get(row.name, [])
            if attrs:
                col_str = ", ".join(f"{a.attribute} {a.data_type}" for a in attrs)
                lines.append(f"  Columns: {col_str}")
            lines.append("")

        return "\n".join(lines)

    # ── public query API ──────────────────────────────────────────────────────

    def get_entity(self, name: str) -> EntityMeta | None:
        with self._Session() as session:
            row = session.get(EntityMetaRow, name)
            return EntityMeta(row) if row else None

    def get_attribute(self, entity: str, attribute: str) -> AttributeMeta | None:
        with self._Session() as session:
            row = session.execute(
                select(AttributeMetaRow).where(
                    AttributeMetaRow.entity == entity,
                    AttributeMetaRow.attribute == attribute,
                )
            ).scalar_one_or_none()
            return AttributeMeta(row) if row else None

    def get_metric(self, name: str) -> MetricMeta | None:
        with self._Session() as session:
            row = session.get(MetricMetaRow, name)
            return MetricMeta(row) if row else None

    def list_entities(self) -> list[str]:
        with self._Session() as session:
            rows = session.execute(select(EntityMetaRow.name)).scalars().all()
            return list(rows)

    def list_metrics(self) -> list[str]:
        with self._Session() as session:
            rows = session.execute(select(MetricMetaRow.name)).scalars().all()
            return list(rows)

    def list_metric_objects(self) -> list[MetricMeta]:
        """Return all metrics as MetricMeta objects (includes formula, unit, etc.)."""
        with self._Session() as session:
            rows = session.execute(select(MetricMetaRow)).scalars().all()
            return [MetricMeta(r) for r in rows]

    def list_context_docs(self) -> list[dict]:
        """Return all context documents as dicts with 'id', 'title', and 'content'."""
        with self._Session() as session:
            rows = session.execute(select(ContextDocRow)).scalars().all()
            return [{"id": r.id, "title": r.title, "content": r.content} for r in rows]

    def seed_glossary_docs(self, terms: dict[str, str]) -> int:
        """Seed glossary terms as Context Documents if they don't already exist.

        Each term becomes a doc with title='Glossary: {term}' and content=definition.
        Never overwrites existing docs.
        Returns count inserted.
        """
        import uuid as _uuid
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc).isoformat()
        count = 0
        with self._Session() as s:
            for term, definition in terms.items():
                title = f"Glossary: {term}"
                existing = s.query(ContextDocRow).filter_by(title=title).first()
                if existing is not None:
                    continue
                row = ContextDocRow(
                    id=str(_uuid.uuid4()),
                    title=title,
                    content=definition,
                    created_at=now,
                )
                s.add(row)
                count += 1
            s.commit()
        return count

    def row_count(self) -> int:
        """Total rows across all catalog tables."""
        with self._Session() as session:
            # count via ORM:
            e = session.query(EntityMetaRow).count()
            a = session.query(AttributeMetaRow).count()
            m = session.query(MetricMetaRow).count()
            return e + a + m

    def prune_phantom_entities(self, known_tables: frozenset[str]) -> int:
        """Remove catalog entities whose backing DuckDB table is not in *known_tables*.

        Prevents phantom table entries — created by the hardcoded populate() methods
        for a golden scenario that doesn't match the actual deployment — from leaking
        into the LLM SQL schema context and causing the model to generate SQL against
        non-existent tables.

        Returns the number of entity rows deleted.
        """
        removed = 0
        with self._Session() as session:
            entity_rows = session.execute(select(EntityMetaRow)).scalars().all()
            names_to_delete: list[str] = []
            for row in entity_rows:
                sources = json.loads(row.sources_json or "[]")
                table = next(
                    (
                        s.get("table")
                        for s in sources
                        if isinstance(s, dict) and s.get("table")
                    ),
                    None,
                )
                if table and table not in known_tables:
                    logger.debug(
                        "prune_phantom_entities: removing entity '%s' (table '%s' absent from DuckDB)",
                        row.name,
                        table,
                    )
                    names_to_delete.append(row.name)
                    session.delete(row)
                    removed += 1
            if names_to_delete:
                session.execute(
                    delete(AttributeMetaRow).where(
                        AttributeMetaRow.entity.in_(names_to_delete)
                    )
                )
            session.commit()
        if removed:
            self._invalidate_schema_context_cache()
            logger.info(
                "prune_phantom_entities: removed %d phantom entity records", removed
            )
        return removed

    # ── draft editing ─────────────────────────────────────────────────────────

    def save_entity_draft(
        self,
        name: str,
        user_description: str | None = None,
        context_notes: str | None = None,
    ) -> bool:
        """Persist user-edited fields for an entity. Returns False if not found."""
        with self._Session() as session:
            row = session.get(EntityMetaRow, name)
            if row is None:
                return False
            if user_description is not None:
                row.user_description = user_description
            if context_notes is not None:
                row.context_notes = context_notes
            session.commit()
        return True

    def save_metric_draft(
        self,
        name: str,
        description: str | None = None,
        formula: str | None = None,
        label: str | None = None,
    ) -> bool:
        """Persist user-edited fields for a metric. Returns False if not found."""
        with self._Session() as session:
            row = session.get(MetricMetaRow, name)
            if row is None:
                return False
            if description is not None:
                row.description = description
            if formula is not None:
                row.formula = formula
            if label is not None:
                row.label = label
            session.commit()
        return True

    def get_draft_entities(self) -> list[dict]:
        """Return all entities with their user-edited fields for the draft editor."""
        with self._Session() as session:
            entity_rows = session.execute(select(EntityMetaRow)).scalars().all()
            all_attrs = session.execute(select(AttributeMetaRow)).scalars().all()
            attrs_by_entity: dict[str, list[AttributeMetaRow]] = {}
            for a in all_attrs:
                attrs_by_entity.setdefault(a.entity, []).append(a)

            result = []
            for row in entity_rows:
                sources = json.loads(row.sources_json or "[]")
                attrs = attrs_by_entity.get(row.name, [])
                result.append(
                    {
                        "name": row.name,
                        "table": next(
                            (
                                s.get("table")
                                for s in sources
                                if isinstance(s, dict) and s.get("table")
                            ),
                            row.name.lower(),
                        ),
                        "columns": [a.attribute for a in attrs],
                        "description": row.description or "",
                        "user_description": getattr(row, "user_description", "") or "",
                        "context_notes": getattr(row, "context_notes", "") or "",
                        "record_count": row.record_count or 0,
                        "sources": [
                            s.get("source", "unknown")
                            for s in sources
                            if isinstance(s, dict)
                        ],
                    }
                )
            return result

    def get_draft_metrics(self) -> list[dict]:
        """Return all metrics as dicts for the draft editor."""
        with self._Session() as session:
            rows = session.execute(select(MetricMetaRow)).scalars().all()
            return [
                {
                    "name": r.name,
                    "label": r.label or "",
                    "description": r.description or "",
                    "formula": r.formula or "",
                    "unit": r.unit or "",
                }
                for r in rows
            ]

    # ── Query template CRUD ────────────────────────────────────────────────

    @staticmethod
    def _template_to_dict(row: "QueryTemplateRow") -> dict:
        import json

        return {
            "id": row.id,
            "name": row.name,
            "description": row.description or "",
            "sql_query": row.sql_query,
            "keywords": json.loads(row.keywords_json or "[]"),
            "sources": json.loads(row.sources_json or "[]"),
            "intent_type": f"tpl_{row.id}",
            "is_active": bool(row.is_active),
            "auto_generated": bool(row.auto_generated),
            "created_at": row.created_at or "",
            "updated_at": row.updated_at or "",
        }

    def list_templates(self, active_only: bool = True) -> list[dict]:
        with self._Session() as s:
            q = s.query(QueryTemplateRow)
            if active_only:
                q = q.filter(QueryTemplateRow.is_active == 1)
            rows = q.order_by(QueryTemplateRow.id).all()
            return [self._template_to_dict(r) for r in rows]

    def create_template(
        self,
        name: str,
        description: str,
        sql_query: str,
        keywords: list[str],
        sources: list[str],
    ) -> dict:
        import json
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc).isoformat()
        row = QueryTemplateRow(
            name=name,
            description=description,
            sql_query=sql_query,
            keywords_json=json.dumps(keywords),
            sources_json=json.dumps(sources),
            created_at=now,
            updated_at=now,
            is_active=1,
        )
        with self._Session() as s:
            s.add(row)
            s.flush()
            result = self._template_to_dict(row)
            s.commit()
        return result

    def update_template(self, template_id: int, **kwargs) -> dict:
        import json
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc).isoformat()
        with self._Session() as s:
            row = s.query(QueryTemplateRow).filter_by(id=template_id).first()
            if row is None:
                raise KeyError(f"Template {template_id} not found")
            if "name" in kwargs and kwargs["name"] is not None:
                row.name = kwargs["name"]
            if "description" in kwargs and kwargs["description"] is not None:
                row.description = kwargs["description"]
            if "sql_query" in kwargs and kwargs["sql_query"] is not None:
                row.sql_query = kwargs["sql_query"]
            if "keywords" in kwargs and kwargs["keywords"] is not None:
                row.keywords_json = json.dumps(kwargs["keywords"])
            if "sources" in kwargs and kwargs["sources"] is not None:
                row.sources_json = json.dumps(kwargs["sources"])
            row.updated_at = now
            row.auto_generated = 0
            result = self._template_to_dict(row)
            s.commit()
        return result

    def delete_template(self, template_id: int) -> None:
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc).isoformat()
        with self._Session() as s:
            row = s.query(QueryTemplateRow).filter_by(id=template_id).first()
            if row is None:
                raise KeyError(f"Template {template_id} not found")
            row.is_active = 0
            row.updated_at = now
            s.commit()

    def upsert_auto_templates(self, templates: list[dict]) -> int:
        """Insert or update auto-generated templates.

        Rules:
        - If name exists with auto_generated=1: update sql/keywords/sources.
        - If name exists with auto_generated=0 (user-edited): skip — never overwrite.
        - If name does not exist: insert with auto_generated=1.
        Returns count of upserted templates.
        """
        import json
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc).isoformat()
        count = 0
        with self._Session() as s:
            for tpl in templates:
                existing = s.query(QueryTemplateRow).filter_by(name=tpl["name"]).first()
                if existing is not None:
                    if not existing.auto_generated:
                        continue  # user-owned — do not overwrite
                    existing.sql_query = tpl["sql_query"]
                    existing.keywords_json = json.dumps(tpl.get("keywords", []))
                    existing.sources_json = json.dumps(tpl.get("sources", []))
                    existing.description = tpl.get("description", "")
                    existing.updated_at = now
                    count += 1
                else:
                    row = QueryTemplateRow(
                        name=tpl["name"],
                        description=tpl.get("description", ""),
                        sql_query=tpl["sql_query"],
                        keywords_json=json.dumps(tpl.get("keywords", [])),
                        sources_json=json.dumps(tpl.get("sources", [])),
                        created_at=now,
                        updated_at=now,
                        is_active=1,
                        auto_generated=1,
                    )
                    s.add(row)
                    count += 1
            s.commit()
        return count

    def seed_default_templates(self, templates: list[dict]) -> int:
        """Seed the DB with default templates on first install.

        Only inserts templates that do not already exist by name.
        Never overwrites existing templates (auto_generated or user-owned).
        Returns count of inserted templates.
        """
        import json
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc).isoformat()
        count = 0
        with self._Session() as s:
            for tpl in templates:
                existing = s.query(QueryTemplateRow).filter_by(name=tpl["name"]).first()
                if existing is not None:
                    continue  # never overwrite
                row = QueryTemplateRow(
                    name=tpl["name"],
                    description=tpl.get("description", ""),
                    sql_query=tpl["sql_query"],
                    keywords_json=json.dumps(tpl.get("keywords", [])),
                    sources_json=json.dumps(tpl.get("sources", [])),
                    created_at=now,
                    updated_at=now,
                    is_active=1,
                    auto_generated=1,
                )
                s.add(row)
                count += 1
            s.commit()
        return count

    # ── entity annotation seeding ────────────────────────────────────────────

    @staticmethod
    def _load_entity_annotations() -> list[dict]:
        """Load entity annotations from entities_config.yaml next to this module."""
        import pathlib as _pathlib

        import yaml as _yaml

        path = _pathlib.Path(__file__).parent / "entities_config.yaml"
        try:
            data = _yaml.safe_load(path.read_text(encoding="utf-8"))
            return data.get("entities", [])
        except Exception:
            return []

    def seed_entity_annotations(self, annotations: list[dict]) -> int:
        """Apply semantic annotations (name, description, field docs) to entities.

        Looks up each entity by table name — matching the ``name`` column used by
        ``populate_from_manager`` when it auto-discovers DuckDB tables.

        Only annotates entities whose tables actually exist in the DB.
        Never overwrites user-edited fields (user_description, context_notes).
        Returns count of entities annotated.
        """
        available = self._get_available_tables()
        count = 0
        with self._Session() as s:
            for ann in annotations:
                table = ann.get("table", "")
                if available and table not in available:
                    continue
                # populate_from_manager stores entities with name=table
                row = s.query(EntityMetaRow).filter_by(name=table).first()
                if row is None:
                    continue  # entity not yet in catalog — auto-extract will create it
                changed = False
                if not row.description or row.description.startswith("Auto-discovered"):
                    new_desc = ann.get("description", "")
                    if new_desc:
                        row.description = new_desc
                        changed = True
                if not row.user_description:
                    new_ud = ann.get("user_description", "")
                    if new_ud:
                        row.user_description = new_ud
                        changed = True
                if not row.context_notes:
                    new_cn = ann.get("context_notes", "")
                    if new_cn:
                        row.context_notes = new_cn
                        changed = True
                if changed:
                    count += 1
            s.commit()
        return count

    # ── internal helpers ──────────────────────────────────────────────────────

    def _upsert_entity(
        self,
        session: Session,
        name: str,
        description: str,
        primary_key: str,
        sources: list[dict],
        record_count: int,
        freshness: str,
        quality_flags: dict,
        kg_node_count: int,
    ) -> None:
        existing = session.get(EntityMetaRow, name)
        if existing:
            existing.description = description
            existing.record_count = record_count
            existing.freshness = freshness
            existing.sources_json = json.dumps(sources)
            existing.quality_flags_json = json.dumps(quality_flags)
            existing.kg_node_count = kg_node_count
            # user_description and context_notes are NOT overwritten here —
            # they are only updated via save_entity_draft()
        else:
            session.add(
                EntityMetaRow(
                    name=name,
                    description=description,
                    primary_key=primary_key,
                    sources_json=json.dumps(sources),
                    record_count=record_count,
                    freshness=freshness,
                    quality_flags_json=json.dumps(quality_flags),
                    kg_node_count=kg_node_count,
                )
            )

    def _upsert_attribute(
        self,
        session: Session,
        entity: str,
        attribute: str,
        data_type: str,
        nullability_rate: float,
        business_definition: str,
        source_path: str,
        sample_values: list,
        lineage_edges: list[dict],
    ) -> None:
        existing = session.execute(
            select(AttributeMetaRow).where(
                AttributeMetaRow.entity == entity,
                AttributeMetaRow.attribute == attribute,
            )
        ).scalar_one_or_none()
        if existing:
            existing.data_type = data_type
            existing.nullability_rate = nullability_rate
            existing.business_definition = business_definition
            existing.source_path = source_path
            existing.sample_values_json = json.dumps(sample_values, default=str)
            existing.lineage_edges_json = json.dumps(lineage_edges)
        else:
            session.add(
                AttributeMetaRow(
                    entity=entity,
                    attribute=attribute,
                    data_type=data_type,
                    nullability_rate=nullability_rate,
                    business_definition=business_definition,
                    source_path=source_path,
                    sample_values_json=json.dumps(sample_values, default=str),
                    lineage_edges_json=json.dumps(lineage_edges),
                )
            )

    # ── per-source population ─────────────────────────────────────────────────

    def _get_available_tables(
        self, mgr=None, connectors: list | None = None
    ) -> set[str]:
        """Return the set of table names currently available in the data layer.

        Queries ``mgr`` (DuckDBSourceManager) when provided, otherwise falls
        back to querying the legacy per-domain connectors via SHOW TABLES / the
        adapter describe() method.  Returns an empty set on any error so callers
        can safely check membership without crashing.
        """
        if mgr is not None:
            try:
                # execute_all(), not execute(): the latter is the
                # frontend-query path and silently caps results at 100 rows —
                # a deployment with >100 tables would then see only a partial
                # listing here, causing _populate_* to skip real entities
                # whose table name happens to sort past the cutoff.
                rows = mgr.execute_all("SHOW TABLES")
                # DuckDB SHOW TABLES returns dicts with a 'name' key
                tables = {r.get("name", "") for r in rows if r.get("name")}
                if tables:
                    return tables
                # Fallback: get_schema_info is authoritative
                schema = mgr.get_schema_info()
                return set(schema.keys())
            except Exception as exc:
                logger.debug("_get_available_tables: mgr query failed: %s", exc)
                return set()

        available: set[str] = set()
        for c in connectors or []:
            try:
                meta = c.describe()
                available.update(meta.tables)
            except Exception as exc:
                logger.debug("_get_available_tables: describe() failed: %s", exc)
        return available

    def _populate_metrics(self, session: Session, ontology) -> None:
        # Static metric definitions
        metrics = [
            MetricMetaRow(
                name="revenue",
                label="Fatturato (ricavi puri)",
                description="Somma di subtotal_amount sugli ordini, esclude tasse e spedizione",
                formula="SUM(sales_order_header.subtotal_amount)",
                unit="USD",
                aliases_json=json.dumps([]),
                requires_join_json=json.dumps([]),
                sources_touched_json=json.dumps(["erp"]),
            ),
            MetricMetaRow(
                name="revenue_with_tax",
                label="Fatturato lordo",
                description="Somma di total_due, include tasse e spedizione",
                formula="SUM(sales_order_header.total_due)",
                unit="USD",
                aliases_json=json.dumps(["incasso", "incassi"]),
                requires_join_json=json.dumps([]),
                sources_touched_json=json.dumps(["erp"]),
            ),
            MetricMetaRow(
                name="margin",
                label="Margine commerciale",
                description="Ricavi meno costi standard di prodotto",
                formula="SUM(sales_order_line.qty * (product.list_price - product.standard_cost))",
                unit="USD",
                aliases_json=json.dumps(["margine"]),
                requires_join_json=json.dumps(["SalesOrderLine", "Product"]),
                sources_touched_json=json.dumps(["erp", "hr_pim"]),
            ),
            MetricMetaRow(
                name="active_customers",
                label="Clienti attivi",
                description="Conteggio distinto di customer_ref con almeno un ordine",
                formula="COUNT(DISTINCT sales_order_header.customer_ref)",
                unit="count",
                aliases_json=json.dumps(["clienti_attivi"]),
                requires_join_json=json.dumps([]),
                sources_touched_json=json.dumps(["erp", "crm"]),
            ),
        ]
        for m in metrics:
            existing = session.get(MetricMetaRow, m.name)
            if not existing:
                session.add(m)

    def _populate_erp(
        self, session: Session, connectors: list, ontology, kg, now: str, mgr=None
    ) -> None:
        # DEPRECATED: entity annotations now loaded from entities_config.yaml via
        # seed_entity_annotations(). This method is kept as a fallback for legacy
        # deployments and will be removed in a future version.
        erp = _find_connector(connectors, "erp")
        if erp is None and mgr is None:
            return

        expected_tables = {
            "sales_order_header",
            "sales_order_line",
            "salesperson",
            "territory",
        }
        available = self._get_available_tables(mgr=mgr, connectors=connectors)
        if available and not (expected_tables & available):
            logger.debug(
                "_populate_erp: none of %s found in available tables, skipping",
                expected_tables,
            )
            return

        # SalesOrder
        if not available or "sales_order_header" in available:
            orders_count = _count_rows("sales_order_header", erp, mgr)
            orders_sample = _sample_rows("sales_order_header", erp, mgr)
            self._upsert_entity(
                session,
                name="SalesOrder",
                description="Sales order header.",
                primary_key="order_id",
                sources=[
                    {"source": "erp", "table": "sales_order_header", "key": "order_id"}
                ],
                record_count=orders_count,
                freshness=now,
                quality_flags={
                    "duplicates_detected": False,
                    "null_rate_warning": False,
                },
                kg_node_count=0,
            )
            _catalog_columns(
                session,
                self._upsert_attribute,
                entity="SalesOrder",
                rows=orders_sample,
                source_prefix="erp.sales_order_header",
                field_definitions={
                    "order_id": "Identificatore ordine",
                    "order_number": "Numero ordine (stringa, es. SO43659)",
                    "order_date": "Data ordine",
                    "total_due": "Totale dovuto (subtotale + tasse + spedizione)",
                    "subtotal_amount": "Ricavi puri (senza tasse)",
                    "customer_ref": "Riferimento cliente (CRM accountId)",
                    "salesperson_ref": "Riferimento venditore (HR MatricolaDip)",
                    "territory_ref": "Riferimento territorio",
                },
                lineage={
                    "subtotal_amount": [
                        {
                            "metric": "revenue",
                            "entity": "SalesOrder",
                            "source_field": "subtotal_amount",
                        }
                    ],
                    "total_due": [
                        {
                            "metric": "revenue_with_tax",
                            "entity": "SalesOrder",
                            "source_field": "total_due",
                        }
                    ],
                },
            )

        # SalesOrderLine
        if not available or "sales_order_line" in available:
            lines_count = _count_rows("sales_order_line", erp, mgr)
            lines_sample = _sample_rows("sales_order_line", erp, mgr)
            self._upsert_entity(
                session,
                name="SalesOrderLine",
                description="Sales order line item.",
                primary_key="(order_id, line_id)",
                sources=[{"source": "erp", "table": "sales_order_line"}],
                record_count=lines_count,
                freshness=now,
                quality_flags={
                    "duplicates_detected": False,
                    "null_rate_warning": False,
                },
                kg_node_count=0,
            )
            _catalog_columns(
                session,
                self._upsert_attribute,
                entity="SalesOrderLine",
                rows=lines_sample,
                source_prefix="erp.sales_order_line",
                field_definitions={
                    "product_ref": "Riferimento prodotto (PIM internal_id)",
                    "qty": "Quantità ordinata",
                    "unit_price": "Prezzo unitario",
                    "line_total": "Totale riga",
                    "offer_ref": "Offerta applicata (1 = nessuna offerta)",
                },
                lineage={
                    "qty": [
                        {
                            "metric": "margin",
                            "entity": "SalesOrderLine",
                            "source_field": "qty",
                        }
                    ],
                    "line_total": [
                        {
                            "metric": "margin",
                            "entity": "SalesOrderLine",
                            "source_field": "line_total",
                        }
                    ],
                },
            )

        # Salesperson
        if not available or "salesperson" in available:
            kg_count_sp = kg.count_nodes_of_type("Salesperson")
            self._upsert_entity(
                session,
                name="Salesperson",
                description="Venditore (sub-ruolo di Employee, con attributi commerciali).",
                primary_key="salesperson_id",
                sources=[
                    {"source": "erp", "table": "salesperson", "key": "salesperson_id"},
                    {
                        "source": "hr_pim",
                        "table": "dipendenti_hr",
                        "key": "MatricolaDip",
                    },
                ],
                record_count=_count_rows("salesperson", erp, mgr),
                freshness=now,
                quality_flags={
                    "duplicates_detected": False,
                    "null_rate_warning": False,
                },
                kg_node_count=kg_count_sp,
            )

        # Territory
        if not available or "territory" in available:
            kg_count_t = kg.count_nodes_of_type("Territory")
            self._upsert_entity(
                session,
                name="Territory",
                description="Territorio commerciale.",
                primary_key="territory_id",
                sources=[
                    {"source": "erp", "table": "territory", "key": "territory_id"}
                ],
                record_count=_count_rows("territory", erp, mgr),
                freshness=now,
                quality_flags={
                    "duplicates_detected": False,
                    "null_rate_warning": False,
                },
                kg_node_count=kg_count_t,
            )

    def _populate_crm(
        self, session: Session, connectors: list, ontology, kg, now: str, mgr=None
    ) -> None:
        # DEPRECATED: entity annotations now loaded from entities_config.yaml via
        # seed_entity_annotations(). This method is kept as a fallback for legacy
        # deployments and will be removed in a future version.
        crm = _find_connector(connectors, "crm")
        if crm is None and mgr is None:
            return

        expected_tables = {"account"}
        available = self._get_available_tables(mgr=mgr, connectors=connectors)
        if available and not (expected_tables & available):
            logger.debug(
                "_populate_crm: none of %s found in available tables, skipping",
                expected_tables,
            )
            return

        total_count = _count_rows("account", crm, mgr)
        dup_count = _count_rows("account", crm, mgr, where="accountId < 0")
        sample = _sample_rows("account", crm, mgr)
        kg_count = kg.count_nodes_of_type("Customer")
        null_email_rate = _null_rate(sample, "emailContatto")

        self._upsert_entity(
            session,
            name="Customer",
            description="Cliente B2C o B2B. accountId < 0 indica duplicato.",
            primary_key="accountId",
            sources=[{"source": "crm", "table": "account", "key": "accountId"}],
            record_count=total_count,
            freshness=now,
            quality_flags={
                "duplicates_detected": dup_count > 0,
                "null_rate_warning": null_email_rate > NULL_RATE_WARN_THRESHOLD,
                "duplicate_count": dup_count,
                "dedup_rule": "accountId < 0 → duplicato; merge per email normalizzata",
            },
            kg_node_count=kg_count,
        )
        _catalog_columns(
            session,
            self._upsert_attribute,
            entity="Customer",
            rows=sample,
            source_prefix="crm.account",
            field_definitions={
                "accountId": "Identificatore account CRM",
                "accountType": "Tipo account: B2C o B2B",
                "ragioneSociale": "Ragione sociale (solo B2B)",
                "nomeContatto": "Nome contatto (solo B2C)",
                "emailContatto": "Email principale",
                "territoryHint": "Territorio suggerito",
                "isActive": "Flag cliente attivo",
            },
            lineage={},
        )

    def _populate_hr_pim(
        self, session: Session, connectors: list, ontology, kg, now: str, mgr=None
    ) -> None:
        # DEPRECATED: entity annotations now loaded from entities_config.yaml via
        # seed_entity_annotations(). This method is kept as a fallback for legacy
        # deployments and will be removed in a future version.
        hr_pim = _find_connector(connectors, "hr_pim")
        if hr_pim is None and mgr is None:
            return

        expected_tables = {"dipendenti_hr", "product_catalog_pim"}
        available = self._get_available_tables(mgr=mgr, connectors=connectors)
        if available and not (expected_tables & available):
            logger.debug(
                "_populate_hr_pim: none of %s found in available tables, skipping",
                expected_tables,
            )
            return

        # Employee (dipendenti_hr)
        if not available or "dipendenti_hr" in available:
            emp_count = _count_rows("dipendenti_hr", hr_pim, mgr)
            emp_sample = _sample_rows("dipendenti_hr", hr_pim, mgr)
            kg_count_e = kg.count_nodes_of_type("Employee")
            null_rate_pay = _null_rate(emp_sample, "RetribuzioneOraria")
            self._upsert_entity(
                session,
                name="Employee",
                description="Dipendente HR. MatricolaDip è anche salesperson_id in ERP.",
                primary_key="MatricolaDip",
                sources=[
                    {
                        "source": "hr_pim",
                        "table": "dipendenti_hr",
                        "key": "MatricolaDip",
                    }
                ],
                record_count=emp_count,
                freshness=now,
                quality_flags={
                    "duplicates_detected": False,
                    "null_rate_warning": null_rate_pay > NULL_RATE_WARN_THRESHOLD,
                },
                kg_node_count=kg_count_e,
            )
            _catalog_columns(
                session,
                self._upsert_attribute,
                entity="Employee",
                rows=emp_sample,
                source_prefix="hr_pim.dipendenti_hr",
                field_definitions={
                    "MatricolaDip": "Matricola dipendente (= salesperson_id ERP)",
                    "Nome": "Nome",
                    "Cognome": "Cognome",
                    "Reparto": "Reparto (es. Engineering, Production)",
                    "GruppoReparto": "Gruppo reparto",
                    "DataAssunzione": "Data assunzione (normalizzata ISO 8601)",
                    "RetribuzioneOraria": "Retribuzione oraria (USD)",
                },
                lineage={},
            )

        # Product (product_catalog_pim)
        if not available or "product_catalog_pim" in available:
            prod_count = _count_rows("product_catalog_pim", hr_pim, mgr)
            prod_sample = _sample_rows("product_catalog_pim", hr_pim, mgr)
            kg_count_p = kg.count_nodes_of_type("Product")
            self._upsert_entity(
                session,
                name="Product",
                description="Prodotto del catalogo PIM.",
                primary_key="internal_id",
                sources=[
                    {
                        "source": "hr_pim",
                        "table": "product_catalog_pim",
                        "key": "internal_id",
                    }
                ],
                record_count=prod_count,
                freshness=now,
                quality_flags={
                    "duplicates_detected": False,
                    "null_rate_warning": False,
                },
                kg_node_count=kg_count_p,
            )
            _catalog_columns(
                session,
                self._upsert_attribute,
                entity="Product",
                rows=prod_sample,
                source_prefix="hr_pim.product_catalog_pim",
                field_definitions={
                    "internal_id": "ID prodotto (= product_ref ERP)",
                    "sku": "SKU alternativo",
                    "displayName": "Nome visualizzato prodotto",
                    "categoryPath": "Percorso categoria (es. Bikes/Mountain Bikes)",
                    "standardCost": "Costo standard (USD)",
                    "listPrice": "Prezzo di listino (USD)",
                    "isMakeOnly": "Prodotto solo internamente",
                    "sellStartDate": "Data inizio vendita (ISO 8601)",
                },
                lineage={
                    "standardCost": [
                        {
                            "metric": "margin",
                            "entity": "Product",
                            "source_field": "standardCost",
                        }
                    ],
                    "listPrice": [
                        {
                            "metric": "margin",
                            "entity": "Product",
                            "source_field": "listPrice",
                        }
                    ],
                },
            )


# ── module-level helpers ──────────────────────────────────────────────────────


def _count_rows(table: str, adapter, mgr, where: str = "") -> int:
    """Return COUNT(*) for *table*, preferring *mgr* over the legacy *adapter*.

    Falls back gracefully to 0 on any error so the catalog population never
    aborts due to a missing table (phantom tables are pruned by
    prune_phantom_entities() afterwards).
    """
    sql = f'SELECT COUNT(*) AS n FROM "{table}"'
    if where:
        sql += f" WHERE {where}"
    if mgr is not None:
        try:
            rows = mgr.execute(sql)
            return int(rows[0]["n"]) if rows else 0
        except Exception:
            return 0
    if adapter is not None:
        try:
            rows = adapter.execute_query(sql)
            return int(rows[0]["n"]) if rows else 0
        except Exception:
            return 0
    return 0


def _sample_rows(table: str, adapter, mgr, limit: int = 200) -> list[dict]:
    """Return up to *limit* rows from *table*, preferring *mgr* over *adapter*."""
    sql = f'SELECT * FROM "{table}" LIMIT {limit}'
    if mgr is not None:
        try:
            # mgr.execute() itself caps at 100 rows by default — pass the
            # requested limit through so a 200-row sample isn't silently
            # truncated to 100 (which would understate column statistics).
            return list(mgr.execute(sql, limit=limit) or [])
        except Exception:
            return []
    if adapter is not None:
        try:
            return list(adapter.execute_query(sql) or [])
        except Exception:
            return []
    return []


def _find_connector(connectors: list, name: str):
    for c in connectors:
        try:
            meta = c.describe()
            if meta.name == name:
                return c
        except Exception as exc:
            import logging as _logging

            _logging.getLogger(__name__).debug(
                "_find_connector: describe() failed: %s", exc
            )
    return None


def _null_rate(rows: list[dict], field: str) -> float:
    if not rows:
        return 0.0
    nulls = sum(1 for r in rows if not r.get(field))
    return nulls / len(rows)


def _catalog_columns(
    session: Session,
    upsert_fn,
    entity: str,
    rows: list[dict],
    source_prefix: str,
    field_definitions: dict[str, str],
    lineage: dict[str, list[dict]],
) -> None:
    """Derive attribute metadata from actual row data."""
    if not rows:
        return
    all_keys = set(rows[0].keys())
    for key in all_keys:
        if key.startswith("_raw_date_"):
            continue
        values = [r.get(key) for r in rows]
        non_null = [v for v in values if v is not None and str(v).strip() != ""]
        null_rate = 1.0 - (len(non_null) / len(rows))
        dtype = _infer_type(non_null)
        samples = list({str(v) for v in non_null[:20] if v is not None})[:5]
        upsert_fn(
            session,
            entity=entity,
            attribute=key,
            data_type=dtype,
            nullability_rate=round(null_rate, 4),
            business_definition=field_definitions.get(key, ""),
            source_path=f"{source_prefix}.{key}",
            sample_values=samples,
            lineage_edges=lineage.get(key, []),
        )


def _infer_type(values: list) -> str:
    if not values:
        return "unknown"
    sample = [v for v in values[:20] if v is not None]
    if not sample:
        return "unknown"
    for v in sample:
        try:
            int(str(v))
            continue
        except ValueError:
            break
    else:
        return "integer"
    for v in sample:
        try:
            float(str(v))
            continue
        except ValueError:
            break
    else:
        return "float"
    return "string"
