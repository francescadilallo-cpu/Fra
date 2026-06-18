"""User-provided context store — documents + structured definitions."""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
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
    is_seeded: bool = False


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
    is_seeded: bool = False


@dataclass
class ContextGlossaryTerm:
    id: int
    term: str
    definition: str
    created_at: str
    is_seeded: bool = False


class ContextStore:
    def __init__(self, db_path: Path = DB_PATH) -> None:
        self._db = db_path
        self._db.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
        # Memoised SemanticDocs — to_semantic_docs_override() runs on every
        # semantic ask, and rereading up to 1500 rows of entities/metrics/
        # glossary per request is pure waste. Invalidated on any mutation.
        self._docs_cache_lock = threading.Lock()
        self._docs_cache: dict[str, object] = {}
        if os.getenv("FRA_SEED_DEMO_SOURCES", "false").strip().lower() in {
            "1",
            "true",
            "yes",
        }:
            try:
                self.seed_demo_data()
            except Exception as _seed_exc:
                logger.warning("Context demo seed skipped: %s", _seed_exc)

    def _invalidate_docs_cache(self) -> None:
        with self._docs_cache_lock:
            self._docs_cache.clear()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute("PRAGMA busy_timeout = 5000")
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
                    created_at TEXT NOT NULL,
                    is_seeded INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS context_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    synonyms TEXT NOT NULL DEFAULT '[]',
                    description TEXT NOT NULL DEFAULT '',
                    unit TEXT NOT NULL DEFAULT '',
                    certified INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    is_seeded INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS context_glossary (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    term TEXT NOT NULL UNIQUE,
                    definition TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    is_seeded INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_ctx_docs_created_at
                    ON context_documents (created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_ctx_entities_created_at
                    ON context_entities (created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_ctx_metrics_created_at
                    ON context_metrics (created_at DESC);
            """)
            # Migrate existing databases: add is_seeded column if absent.
            for table in ("context_entities", "context_metrics", "context_glossary"):
                try:
                    conn.execute(
                        f"ALTER TABLE {table} ADD COLUMN is_seeded INTEGER NOT NULL DEFAULT 0"  # noqa: S608
                    )
                except sqlite3.OperationalError:
                    pass  # column already exists
            # Backfill is_seeded=1 for known demo-seeded records so that
            # existing databases (seeded before this column existed) are also
            # correctly filtered when a live-mode user queries the store.
            _seeded_entities = (
                "SalesOrder",
                "Customer",
                "Salesperson",
                "Territory",
                "Product",
                "Employee",
                "SalesOrderLine",
            )
            _seeded_metrics = (
                "total_revenue",
                "gross_revenue",
                "order_count",
                "active_customers",
                "avg_order_value",
            )
            _seeded_terms = (
                "fatturato",
                "subtotal_amount",
                "total_due",
                "bridge",
                "matricoladip",
                "online_order_flag",
                "knowledge_graph",
            )
            conn.execute(
                "UPDATE context_entities SET is_seeded=1 WHERE name IN ({})".format(  # noqa: S608
                    ",".join("?" * len(_seeded_entities))
                ),
                _seeded_entities,
            )
            conn.execute(
                "UPDATE context_metrics SET is_seeded=1 WHERE name IN ({})".format(  # noqa: S608
                    ",".join("?" * len(_seeded_metrics))
                ),
                _seeded_metrics,
            )
            conn.execute(
                "UPDATE context_glossary SET is_seeded=1 WHERE term IN ({})".format(  # noqa: S608
                    ",".join("?" * len(_seeded_terms))
                ),
                _seeded_terms,
            )

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
                "SELECT * FROM context_documents ORDER BY created_at DESC LIMIT 500"
            ).fetchall()
        return [ContextDocument(**dict(r)) for r in rows]

    def list_document_meta(self) -> list[ContextDocument]:
        """Return all documents with content='' — avoids loading large text blobs
        when only the listing metadata (id, filename, file_type, created_at) is needed."""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, filename, '' AS content, file_type, created_at "
                "FROM context_documents ORDER BY created_at DESC LIMIT 500"
            ).fetchall()
        return [ContextDocument(**dict(r)) for r in rows]

    def delete_document(self, doc_id: int) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM context_documents WHERE id=?", (doc_id,))
        return cur.rowcount > 0

    def search_documents(self, keywords: list[str]) -> list[str]:
        if not keywords:
            return []
        # Pre-filter at the SQL level so the full collection is never loaded
        # into Python when only a small fraction of docs are relevant.
        like_clause = " OR ".join("LOWER(content) LIKE ?" for _ in keywords)
        params = [f"%{kw.lower()}%" for kw in keywords]
        with self._conn() as conn:
            rows = conn.execute(
                f"SELECT filename, content FROM context_documents "  # noqa: S608
                f"WHERE {like_clause} ORDER BY created_at DESC LIMIT 50",
                params,
            ).fetchall()
        snippets: list[str] = []
        for row in rows:
            for para in (p.strip() for p in row["content"].split("\n\n") if p.strip()):
                if any(kw.lower() in para.lower() for kw in keywords):
                    snippets.append(f"[{row['filename']}]: {para[:500]}")
                    if len(snippets) >= 10:
                        return snippets
        return snippets

    # ── Entities ───────────────────────────────────────────────────────────────

    def add_entity(
        self,
        name: str,
        display_name: str,
        synonyms: list[str],
        description: str,
        source: str,
        is_seeded: bool = False,
    ) -> ContextEntity:
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO context_entities"
                " (name, display_name, synonyms, description, source, created_at, is_seeded)"
                " VALUES (?,?,?,?,?,?,?)",
                (
                    name,
                    display_name,
                    json.dumps(synonyms),
                    description,
                    source,
                    self._now(),
                    int(is_seeded),
                ),
            )
            row = conn.execute(
                "SELECT * FROM context_entities WHERE id=?", (cur.lastrowid,)
            ).fetchone()
        d = dict(row)
        d["synonyms"] = json.loads(d["synonyms"])
        d["is_seeded"] = bool(d["is_seeded"])
        self._invalidate_docs_cache()
        return ContextEntity(**d)

    def list_entities(self, exclude_seeded: bool = False) -> list[ContextEntity]:
        filt = " WHERE is_seeded = 0" if exclude_seeded else ""
        with self._conn() as conn:
            rows = conn.execute(
                f"SELECT * FROM context_entities{filt} ORDER BY created_at DESC LIMIT 500"  # noqa: S608
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["synonyms"] = json.loads(d["synonyms"])
            d["is_seeded"] = bool(d.get("is_seeded", 0))
            result.append(ContextEntity(**d))
        return result

    def delete_entity(self, entity_id: int) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM context_entities WHERE id=?", (entity_id,))
        self._invalidate_docs_cache()
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
        is_seeded: bool = False,
    ) -> ContextMetric:
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO context_metrics"
                " (name, display_name, synonyms, description, unit, certified, created_at, is_seeded)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (
                    name,
                    display_name,
                    json.dumps(synonyms),
                    description,
                    unit,
                    int(certified),
                    self._now(),
                    int(is_seeded),
                ),
            )
            row = conn.execute(
                "SELECT * FROM context_metrics WHERE id=?", (cur.lastrowid,)
            ).fetchone()
        d = dict(row)
        d["synonyms"] = json.loads(d["synonyms"])
        d["certified"] = bool(d["certified"])
        d["is_seeded"] = bool(d["is_seeded"])
        self._invalidate_docs_cache()
        return ContextMetric(**d)

    def list_metrics(self, exclude_seeded: bool = False) -> list[ContextMetric]:
        filt = " WHERE is_seeded = 0" if exclude_seeded else ""
        with self._conn() as conn:
            rows = conn.execute(
                f"SELECT * FROM context_metrics{filt} ORDER BY created_at DESC LIMIT 500"  # noqa: S608
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["synonyms"] = json.loads(d["synonyms"])
            d["certified"] = bool(d["certified"])
            d["is_seeded"] = bool(d.get("is_seeded", 0))
            result.append(ContextMetric(**d))
        return result

    def delete_metric(self, metric_id: int) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM context_metrics WHERE id=?", (metric_id,))
        self._invalidate_docs_cache()
        return cur.rowcount > 0

    # ── Glossary ───────────────────────────────────────────────────────────────

    def add_glossary_term(
        self,
        term: str,
        definition: str,
        is_seeded: bool = False,
    ) -> ContextGlossaryTerm:
        t = term.lower().strip()
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO context_glossary"
                " (term, definition, created_at, is_seeded) VALUES (?,?,?,?)",
                (t, definition, self._now(), int(is_seeded)),
            )
            row = conn.execute(
                "SELECT * FROM context_glossary WHERE term=?", (t,)
            ).fetchone()
        d = dict(row)
        d["is_seeded"] = bool(d.get("is_seeded", 0))
        self._invalidate_docs_cache()
        return ContextGlossaryTerm(**d)

    def list_glossary(self, exclude_seeded: bool = False) -> list[ContextGlossaryTerm]:
        filt = " WHERE is_seeded = 0" if exclude_seeded else ""
        with self._conn() as conn:
            rows = conn.execute(
                f"SELECT * FROM context_glossary{filt} ORDER BY term LIMIT 500"  # noqa: S608
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["is_seeded"] = bool(d.get("is_seeded", 0))
            result.append(ContextGlossaryTerm(**d))
        return result

    def delete_glossary_term(self, term_id: int) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM context_glossary WHERE id=?", (term_id,))
        self._invalidate_docs_cache()
        return cur.rowcount > 0

    # ── Semantic docs merge ────────────────────────────────────────────────────

    def seed_demo_data(self) -> int:
        """Seed AdventureWorks demo entities/metrics/glossary if the store is empty.

        Idempotent — does nothing when records already exist.
        Returns the number of rows inserted.
        """
        with self._conn() as conn:
            if conn.execute("SELECT COUNT(*) FROM context_entities").fetchone()[0] > 0:
                return 0

        inserted = 0
        now = self._now()

        entities = [
            (
                "SalesOrder",
                "Sales Order",
                ["order", "ordine", "vendita"],
                "Customer purchase order from ERP (sales_order_header + lines). "
                "Key fields: subtotalAmount (net revenue), totalDue (gross), onlineOrderFlag.",
                "erp",
            ),
            (
                "Customer",
                "Customer",
                ["account", "cliente", "buyer", "conto"],
                "Legal entity that places orders. Source: crm.accounts (ClientHub). "
                "Bridge: accountId ↔ ERP customer_ref (93.2% match — 18,484 / 19,829).",
                "crm",
            ),
            (
                "Salesperson",
                "Salesperson",
                ["rep", "agent", "venditore", "agente commerciale"],
                "Sales representative bridged to HR via salesPersonId ↔ matricolaDip. "
                "14 active reps. Top performer: Linda Mitchell ($4.25M YTD).",
                "erp",
            ),
            (
                "Territory",
                "Territory",
                ["region", "area", "zona", "distretto"],
                "Sales territory grouping customers and reps by geography. 10 territories.",
                "erp",
            ),
            (
                "Product",
                "Product",
                ["item", "sku", "articolo", "prodotto"],
                "Product catalogue from PIM (product_catalog). 504 products. "
                "Bikes category = 98% of revenue.",
                "pim",
            ),
            (
                "Employee",
                "Employee",
                ["dipendente", "worker", "staff"],
                "HR record with Italian schema (matricolaDip, cognome, nome, stipendio, ruolo). "
                "290 employees. Bridge: matricolaDip ↔ ERP salesPersonId.",
                "hr",
            ),
            (
                "SalesOrderLine",
                "Sales Order Line",
                ["order line", "riga ordine", "line item"],
                "Line-level detail: orderId, productId (→ PIM), quantity, unitPrice, "
                "unitPriceDiscount, lineTotal. 121,317 rows.",
                "erp",
            ),
        ]
        for name, display_name, synonyms, description, source in entities:
            self.add_entity(
                name, display_name, synonyms, description, source, is_seeded=True
            )
            inserted += 1

        metrics = [
            (
                "total_revenue",
                "Total Revenue",
                ["fatturato", "ricavi", "revenue", "entrate"],
                "SUM of SubTotal from sales_order_header — pre-tax, pre-freight. "
                "Authoritative revenue metric. 2014: $20.1M.",
                "USD",
                True,
            ),
            (
                "gross_revenue",
                "Gross Revenue",
                ["ricavi lordi", "total_due", "billed revenue", "fatturato lordo"],
                "SUM of TotalDue — includes tax + freight (~11.3% above net). "
                "$22.4M in 2014. Use for billing/AR, NOT commercial KPIs.",
                "USD",
                False,
            ),
            (
                "order_count",
                "Order Count",
                ["numero ordini", "orders", "transazioni"],
                "COUNT(DISTINCT SalesOrderID). 31,465 total orders in dataset.",
                "count",
                True,
            ),
            (
                "active_customers",
                "Active Customers",
                ["clienti attivi", "buyers"],
                "Customers with ≥1 order in the period. Based on ERP↔CRM bridge "
                "(93.2% match rate = 18,484 matched accounts).",
                "count",
                True,
            ),
            (
                "avg_order_value",
                "Avg. Order Value",
                ["valore medio ordine", "AOV", "ticket medio"],
                "total_revenue / order_count. Calculated on SubTotal (net). "
                "Excludes tax and freight.",
                "USD",
                False,
            ),
        ]
        for name, display_name, synonyms, description, unit, certified in metrics:
            self.add_metric(
                name,
                display_name,
                synonyms,
                description,
                unit,
                certified,
                is_seeded=True,
            )
            inserted += 1

        glossary = [
            (
                "fatturato",
                "Italian term for revenue. In OrionSales → subtotalAmount (SubTotal, pre-tax). "
                "NOT TotalDue. Always use total_revenue metric (SUM of SubTotal) when asked for fatturato.",
            ),
            (
                "subtotal_amount",
                "ERP field SubTotal in sales_order_header. Pre-tax, pre-freight. "
                "Correct revenue figure for commercial reporting ($20.1M in 2014). "
                "Maps to total_revenue metric.",
            ),
            (
                "total_due",
                "ERP field TotalDue. Includes tax + freight (~11.3% above SubTotal). "
                "$22.4M in 2014. Use for billing/AR. Do NOT use for revenue KPIs unless explicitly requested.",
            ),
            (
                "bridge",
                "Cross-system join linking records across sources. "
                "ERP↔CRM: customer_ref ↔ accountId (93.2% match). "
                "ERP↔HR: salesPersonId ↔ matricolaDip (100%). "
                "ERP↔PIM: productId ↔ internal_id.",
            ),
            (
                "matricoladip",
                "Italian HR primary key for employees (employee ID). "
                "Bridges to ERP salesPersonId. 14/14 reps matched (100% bridge health).",
            ),
            (
                "online_order_flag",
                "Boolean in sales_order_header. 1 = online channel (87.9% of orders), "
                "0 = in-store/offline (12.1%). Use for channel segmentation.",
            ),
            (
                "knowledge_graph",
                "Unified in-memory graph of all entities across ERP/CRM/HR/PIM. "
                "193,062 nodes, 313,193 edges. "
                "Deduplication removes 372 CRM duplicate accounts (accountId < 0).",
            ),
        ]
        for term, definition in glossary:
            self.add_glossary_term(term, definition, is_seeded=True)
            inserted += 1

        # Seed a process context document
        _ORION_CONTEXT_DOC = """\
# OrionSales Process Context

## Overview
OrionSales is a B2B sales management platform integrating four data sources:
ERP (OrionSales PostgreSQL), CRM (ClientHub SQLite), HR (CSV, Italian schema),
and PIM (JSON product catalog). The semantic layer unifies these into a single
queryable knowledge graph.

## Data Sources
- **ERP (erp)**: sales_order_header (31,465 orders), sales_order_line (121,317 lines),
  salesperson (17 reps), territory (10), special_offer (16).
- **CRM (crm)**: accounts/contacts/addresses (20,201 raw → 19,829 clean after dedup).
  Warning: 372 duplicate accounts with accountId < 0 from legacy migration.
- **HR (hr)**: dipendenti_hr (290 employees, Italian schema — matricolaDip, cognome,
  nome, stipendio, ruolo, repartoId).
- **PIM (pim)**: product_catalog (504 products; Bikes = 98% of revenue).

## Revenue Disambiguation
The most important semantic rule: "revenue" / "fatturato" maps to TWO columns:
- **subtotalAmount** (SubTotal) = $20.1M (2014) — pre-tax, pre-freight. Use for commercial KPIs.
- **totalDue** = $22.4M (2014) — includes tax and freight. Use for billing/AR.
Default: always use **subtotalAmount** unless "gross" or "total_due" is explicitly requested.

## Cross-Source Bridges
1. **ERP↔CRM (PLACED_BY)**: customer_ref ↔ accountId — 18,484/19,829 matched (93.2%).
   Unmatched 1,345 accounts are CRM-only prospects (never placed an order).
2. **ERP↔HR (SOLD_BY)**: salesPersonId ↔ matricolaDip — 14/14 matched (100%).
3. **ERP↔PIM (OF_PRODUCT)**: productId ↔ internal_id — 47 orphan order lines (no PIM match).

## Order Lifecycle
Lead → Opportunity → Quote → SalesOrder → SalesOrderLine → Invoice (TotalDue).
Online orders = 87.9% of volume (onlineOrderFlag=1). In-store = 12.1%.

## Key Metrics (2014)
- Total orders: 31,465 | Net revenue: $20.1M | Gross revenue: $22.4M
- Active customers: 18,484 | Knowledge Graph: 193,062 nodes, 313,193 edges
- Top rep: Linda Mitchell ($4.25M YTD) | Territory count: 10
"""
        with self._conn() as conn:
            if (
                conn.execute("SELECT COUNT(*) FROM context_documents").fetchone()[0]
                == 0
            ):
                conn.execute(
                    "INSERT INTO context_documents (filename, content, file_type, created_at) VALUES (?,?,?,?)",
                    ("OrionSales_Process_Context.md", _ORION_CONTEXT_DOC, "md", now),
                )
                inserted += 1

        self._invalidate_docs_cache()
        return inserted

    def to_semantic_docs_override(self, mode: str = "demo"):
        from app.semantic.doc_schema import (
            EntityDoc,
            GlossaryTerm,
            MetricDoc,
            SemanticDocs,
        )

        with self._docs_cache_lock:
            if mode in self._docs_cache:
                return self._docs_cache[mode]
            # Build inside the lock so a concurrent _invalidate_docs_cache()
            # cannot overwrite a stale computation that started before the
            # invalidation but stores after it.
            exclude = mode == "live"
            entities = [
                EntityDoc(
                    name=e.name,
                    display_name=e.display_name,
                    synonyms=e.synonyms,
                    description=e.description,
                    source=e.source,
                )
                for e in self.list_entities(exclude_seeded=exclude)
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
                for m in self.list_metrics(exclude_seeded=exclude)
            ]
            glossary = [
                GlossaryTerm(term=g.term, definition=g.definition)
                for g in self.list_glossary(exclude_seeded=exclude)
            ]
            result = SemanticDocs(
                entities=entities,
                metrics=metrics,
                glossary=glossary,
                disambiguation_rules=[],
            )
            self._docs_cache[mode] = result
            return result


# Module-level singleton — import this instead of constructing a new instance
default_store = ContextStore()
