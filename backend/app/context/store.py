"""User-provided context store — documents + structured definitions."""

from __future__ import annotations

import json
import logging
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).parent.parent.parent / "data" / "context.db"


@dataclass
class ContextDocument:
    id: int
    filename: str
    content: str
    file_type: str
    created_at: str


@dataclass
class ContextEntity:
    id: int
    name: str
    display_name: str
    synonyms: list[str]
    description: str
    source: str
    created_at: str


@dataclass
class ContextMetric:
    id: int
    name: str
    display_name: str
    synonyms: list[str]
    description: str
    unit: str
    certified: bool
    created_at: str


@dataclass
class ContextGlossaryTerm:
    id: int
    term: str
    definition: str
    created_at: str


class ContextStore:
    def __init__(self, db_path: Path = DB_PATH) -> None:
        self._db = db_path
        self._db.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS context_documents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    filename TEXT NOT NULL,
                    content TEXT NOT NULL,
                    file_type TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS context_entities (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    synonyms TEXT NOT NULL DEFAULT '[]',
                    description TEXT NOT NULL DEFAULT '',
                    source TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS context_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    synonyms TEXT NOT NULL DEFAULT '[]',
                    description TEXT NOT NULL DEFAULT '',
                    unit TEXT NOT NULL DEFAULT '',
                    certified INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS context_glossary (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    term TEXT NOT NULL UNIQUE,
                    definition TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
            """)

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    # ── Documents ──────────────────────────────────────────────────────────────

    def add_document(
        self, filename: str, content: str, file_type: str
    ) -> ContextDocument:
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO context_documents (filename, content, file_type, created_at) VALUES (?,?,?,?)",
                (filename, content, file_type, self._now()),
            )
            row = conn.execute(
                "SELECT * FROM context_documents WHERE id=?", (cur.lastrowid,)
            ).fetchone()
        return ContextDocument(**dict(row))

    def list_documents(self) -> list[ContextDocument]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM context_documents ORDER BY created_at DESC"
            ).fetchall()
        return [ContextDocument(**dict(r)) for r in rows]

    def delete_document(self, doc_id: int) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM context_documents WHERE id=?", (doc_id,))
        return cur.rowcount > 0

    def search_documents(self, keywords: list[str]) -> list[str]:
        snippets: list[str] = []
        for doc in self.list_documents():
            for para in (p.strip() for p in doc.content.split("\n\n") if p.strip()):
                if any(kw.lower() in para.lower() for kw in keywords):
                    snippets.append(f"[{doc.filename}]: {para[:500]}")
        return snippets[:10]

    # ── Entities ───────────────────────────────────────────────────────────────

    def add_entity(
        self,
        name: str,
        display_name: str,
        synonyms: list[str],
        description: str,
        source: str,
    ) -> ContextEntity:
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO context_entities (name, display_name, synonyms, description, source, created_at)"
                " VALUES (?,?,?,?,?,?)",
                (
                    name,
                    display_name,
                    json.dumps(synonyms),
                    description,
                    source,
                    self._now(),
                ),
            )
            row = conn.execute(
                "SELECT * FROM context_entities WHERE id=?", (cur.lastrowid,)
            ).fetchone()
        d = dict(row)
        d["synonyms"] = json.loads(d["synonyms"])
        return ContextEntity(**d)

    def list_entities(self) -> list[ContextEntity]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM context_entities ORDER BY created_at DESC"
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["synonyms"] = json.loads(d["synonyms"])
            result.append(ContextEntity(**d))
        return result

    def delete_entity(self, entity_id: int) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM context_entities WHERE id=?", (entity_id,))
        return cur.rowcount > 0

    # ── Metrics ────────────────────────────────────────────────────────────────

    def add_metric(
        self,
        name: str,
        display_name: str,
        synonyms: list[str],
        description: str,
        unit: str,
        certified: bool,
    ) -> ContextMetric:
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO context_metrics"
                " (name, display_name, synonyms, description, unit, certified, created_at)"
                " VALUES (?,?,?,?,?,?,?)",
                (
                    name,
                    display_name,
                    json.dumps(synonyms),
                    description,
                    unit,
                    int(certified),
                    self._now(),
                ),
            )
            row = conn.execute(
                "SELECT * FROM context_metrics WHERE id=?", (cur.lastrowid,)
            ).fetchone()
        d = dict(row)
        d["synonyms"] = json.loads(d["synonyms"])
        d["certified"] = bool(d["certified"])
        return ContextMetric(**d)

    def list_metrics(self) -> list[ContextMetric]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM context_metrics ORDER BY created_at DESC"
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["synonyms"] = json.loads(d["synonyms"])
            d["certified"] = bool(d["certified"])
            result.append(ContextMetric(**d))
        return result

    def delete_metric(self, metric_id: int) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM context_metrics WHERE id=?", (metric_id,))
        return cur.rowcount > 0

    # ── Glossary ───────────────────────────────────────────────────────────────

    def add_glossary_term(self, term: str, definition: str) -> ContextGlossaryTerm:
        t = term.lower().strip()
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO context_glossary (term, definition, created_at) VALUES (?,?,?)",
                (t, definition, self._now()),
            )
            row = conn.execute(
                "SELECT * FROM context_glossary WHERE term=?", (t,)
            ).fetchone()
        return ContextGlossaryTerm(**dict(row))

    def list_glossary(self) -> list[ContextGlossaryTerm]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM context_glossary ORDER BY term"
            ).fetchall()
        return [ContextGlossaryTerm(**dict(r)) for r in rows]

    def delete_glossary_term(self, term_id: int) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM context_glossary WHERE id=?", (term_id,))
        return cur.rowcount > 0

    # ── Semantic docs merge ────────────────────────────────────────────────────

    def to_semantic_docs_override(self):
        from app.semantic.doc_schema import (
            EntityDoc,
            GlossaryTerm,
            MetricDoc,
            SemanticDocs,
        )

        entities = [
            EntityDoc(
                name=e.name,
                display_name=e.display_name,
                synonyms=e.synonyms,
                description=e.description,
                source=e.source,
            )
            for e in self.list_entities()
        ]
        metrics = [
            MetricDoc(
                name=m.name,
                display_name=m.display_name,
                synonyms=m.synonyms,
                description=m.description,
                unit=m.unit or None,
                certified=m.certified,
            )
            for m in self.list_metrics()
        ]
        glossary = [
            GlossaryTerm(term=g.term, definition=g.definition)
            for g in self.list_glossary()
        ]
        return SemanticDocs(
            entities=entities,
            metrics=metrics,
            glossary=glossary,
            disambiguation_rules=[],
        )


# Module-level singleton — import this instead of constructing a new instance
default_store = ContextStore()
