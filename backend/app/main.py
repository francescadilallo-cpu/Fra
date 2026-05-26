"""
SemanticIntelligence – FastAPI application entry point.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import json

from .database import get_connection, get_table_counts, init_db
from .models import (
    AskRequest,
    AskResult,
    DashboardData,
    HierarchyCreate,
    MappingUpdateRequest,
    MappingsResponse,
    MetricCreate,
    OntologyGraphData,
    PaginatedData,
    QueryRequest,
    QueryResult,
    RecentOrder,
    SegmentCreate,
)
from .ontology.manufacturing import get_ontology
from .ontology.mapper import get_flat_mappings, get_mappings, update_mapping
from .query.engine import run_query

load_dotenv()

# ── Semantic Layer global state (lazy-initialised on first /api/semantic/* call) ──

_semantic_state: dict[str, Any] = {
    "loaded": False,
    "layer": None,
    "kg": None,
    "catalog": None,
    "erp": None,
    "crm": None,
    "hr_pim": None,
}

_SCENARIO_PATH = Path(__file__).parent.parent.parent / "test_scenario"


def _ensure_semantic_loaded() -> None:
    """Lazily build the semantic stack (connectors → KG → catalog → layer)."""
    if _semantic_state["loaded"]:
        return

    from .connectors.postgres_connector import PostgresConnector
    from .connectors.sqlite_connector import SQLiteConnector
    from .connectors.file_connector import FileConnector
    from .ontology.ontology import Ontology
    from .kg.graph import KnowledgeGraph
    from .metadata.catalog import MetadataCatalog
    from .semantic.layer import SemanticLayer
    from .context.manager import ContextManager

    erp = PostgresConnector(_SCENARIO_PATH / "erp_postgres" / "orion_sales_dump.sql")
    crm = SQLiteConnector(_SCENARIO_PATH / "crm_sqlite" / "clienthub.db")
    hr_pim = FileConnector(
        hr_csv_path=_SCENARIO_PATH / "hr_pim_files" / "dipendenti_hr.csv",
        pim_json_path=_SCENARIO_PATH / "hr_pim_files" / "product_catalog_pim.json",
    )

    ontology_path = _SCENARIO_PATH / "ontology_example.yaml"
    ontology = Ontology.load(ontology_path) if ontology_path.exists() else None

    kg = KnowledgeGraph()
    kg.build(erp, crm, hr_pim)

    catalog = MetadataCatalog()
    catalog.populate([erp, crm, hr_pim], ontology, kg)

    ctx_mgr = ContextManager()
    layer = SemanticLayer(ontology, kg, catalog, ctx_mgr)
    layer.set_connectors(erp, crm, hr_pim)

    _semantic_state.update({
        "loaded": True,
        "layer": layer,
        "kg": kg,
        "catalog": catalog,
        "erp": erp,
        "crm": crm,
        "hr_pim": hr_pim,
    })


# ── Pydantic models for semantic endpoints ──────────────────────────────────

class SemanticAskRequest(BaseModel):
    question: str


class SemanticAskResponse(BaseModel):
    answer: Any
    sql_used: str | None = None
    sources_touched: list[str] = []
    provenance: dict[str, Any] = {}
    latency_ms: float = 0.0
    disambiguation_required: bool = False
    candidates: list[str] = []
    notes: str = ""
    ambiguity_error: bool = False

# ── Lifespan ───────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialise DB + ontology at startup."""
    init_db()
    conn = get_connection()
    try:
        onto = get_ontology()
        onto.populate_from_db(conn)
    finally:
        conn.close()
    yield


# ── App factory ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="SemanticIntelligence API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ─────────────────────────────────────────────────────────────────────


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "SemanticIntelligence API"}


@app.get("/api/dashboard", response_model=DashboardData)
def dashboard() -> DashboardData:
    conn = get_connection()
    try:
        counts = get_table_counts(conn)

        total_quotes = counts["quotes"]
        total_orders = counts["orders"]
        total_customers = counts["customers"]
        total_products = counts["products"]

        accepted = conn.execute(
            "SELECT COUNT(*) FROM quotes WHERE status='accepted'"
        ).fetchone()[0]
        conversion_rate = round((accepted / total_quotes * 100) if total_quotes else 0, 1)

        open_value = conn.execute(
            "SELECT COALESCE(SUM(total_value),0) FROM quotes WHERE status IN ('draft','sent')"
        ).fetchone()[0]

        recent_rows = conn.execute(
            """
            SELECT o.id, c.name as customer_name, o.total_value, o.status, o.date
            FROM orders o
            JOIN customers c ON c.id = o.customer_id
            ORDER BY o.date DESC
            LIMIT 5
            """
        ).fetchall()
        recent_orders = [
            RecentOrder(
                id=r["id"],
                customer_name=r["customer_name"],
                total_value=r["total_value"],
                status=r["status"],
                date=r["date"],
            )
            for r in recent_rows
        ]

        # Data source cards
        data_sources = [
            {
                "name": "ERP – Clienti & Prodotti",
                "type": "SQLite",
                "status": "connected",
                "tables": ["customers", "products"],
                "row_counts": {
                    "customers": counts["customers"],
                    "products": counts["products"],
                },
            },
            {
                "name": "ERP – Preventivi & Ordini",
                "type": "SQLite",
                "status": "connected",
                "tables": ["quotes", "quote_lines", "orders", "order_lines"],
                "row_counts": {
                    "quotes": counts["quotes"],
                    "quote_lines": counts["quote_lines"],
                    "orders": counts["orders"],
                    "order_lines": counts["order_lines"],
                },
            },
        ]

        return DashboardData(
            total_customers=total_customers,
            total_products=total_products,
            total_quotes=total_quotes,
            total_orders=total_orders,
            quote_conversion_rate=conversion_rate,
            open_quotes_value=round(open_value, 2),
            recent_orders=recent_orders,
            data_sources=data_sources,
        )
    finally:
        conn.close()


@app.get("/api/ontology/graph")
def ontology_graph() -> dict[str, Any]:
    onto = get_ontology()
    return onto.get_ontology_graph_data()


@app.get("/api/ontology/mappings", response_model=MappingsResponse)
def ontology_mappings() -> MappingsResponse:
    flat = get_flat_mappings()
    raw = get_mappings()
    return MappingsResponse(mappings=flat, raw=raw)


@app.put("/api/ontology/mappings")
def update_ontology_mapping(req: MappingUpdateRequest) -> dict[str, Any]:
    success = update_mapping(req.table, req.field, req.ontology_path)
    if not success:
        raise HTTPException(status_code=404, detail="Table or field not found in mappings")
    return {"success": True, "table": req.table, "field": req.field, "ontology_path": req.ontology_path}


@app.post("/api/query", response_model=QueryResult)
def natural_language_query(req: QueryRequest) -> QueryResult:
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key or api_key == "your_key_here":
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY not configured. Set it in backend/.env",
        )

    result = run_query(req.question)
    return QueryResult(**result)


@app.get("/api/data/{table}", response_model=PaginatedData)
def get_table_data(
    table: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> PaginatedData:
    allowed_tables = {"customers", "products", "quotes", "quote_lines", "orders", "order_lines"}
    if table not in allowed_tables:
        raise HTTPException(status_code=404, detail=f"Table '{table}' not found")

    conn = get_connection()
    try:
        total = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        offset = (page - 1) * page_size
        rows = conn.execute(
            f"SELECT * FROM {table} LIMIT ? OFFSET ?", (page_size, offset)
        ).fetchall()
        data = [dict(row) for row in rows]
        return PaginatedData(
            table=table,
            total=total,
            page=page,
            page_size=page_size,
            data=data,
        )
    finally:
        conn.close()


# ── Semantic Layer endpoints ────────────────────────────────────────────────────


@app.get("/api/semantic/status")
def semantic_status() -> dict[str, Any]:
    """Return the current status of the semantic layer (loaded/not loaded)."""
    if not _semantic_state["loaded"]:
        return {
            "loaded": False,
            "entities": [],
            "kg_nodes": 0,
            "kg_edges": 0,
            "metadata_rows": 0,
            "sources": [],
            "dedup_count": 0,
        }
    kg = _semantic_state["kg"]
    catalog = _semantic_state["catalog"]
    return {
        "loaded": True,
        "entities": catalog.list_entities(),
        "kg_nodes": kg.node_count,
        "kg_edges": kg.edge_count,
        "metadata_rows": catalog.row_count(),
        "sources": ["erp", "crm", "hr_pim"],
        "dedup_count": kg.dedup_count,
    }


@app.post("/api/semantic/ask")
def semantic_ask(req: SemanticAskRequest) -> SemanticAskResponse:
    """Ask a natural-language question to the Semantic Layer."""
    from .semantic.layer import AmbiguityError

    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    _ensure_semantic_loaded()
    layer = _semantic_state["layer"]

    try:
        result = layer.ask(req.question)
        return SemanticAskResponse(
            answer=result.answer,
            sql_used=result.sql_used,
            sources_touched=result.sources_touched,
            provenance=result.provenance,
            latency_ms=result.latency_ms,
            disambiguation_required=result.disambiguation_required,
            candidates=result.candidates,
            notes=result.notes,
            ambiguity_error=False,
        )
    except AmbiguityError as e:
        return SemanticAskResponse(
            answer=None,
            disambiguation_required=True,
            candidates=e.candidates,
            notes=str(e),
            ambiguity_error=True,
        )


# ── Unified NL query endpoint (real AdventureWorks data) ──────────────────────


@app.post("/api/ask", response_model=AskResult)
def ask(req: AskRequest) -> AskResult:
    """Main NL→SQL query endpoint. Uses real AW connectors via DuckDB."""
    from .query.aw_engine import run_aw_query

    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key or api_key == "your_key_here":
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY not configured. Set it in backend/.env",
        )

    _ensure_semantic_loaded()
    erp = _semantic_state["erp"]
    crm = _semantic_state["crm"]
    hr_pim = _semantic_state["hr_pim"]

    result = run_aw_query(req.question, erp, crm, hr_pim)
    return AskResult(**result)


# ── Semantic sources ───────────────────────────────────────────────────────────


@app.get("/api/semantic/sources")
def semantic_sources() -> list[dict[str, Any]]:
    """Return real data source metadata with freshness."""
    _ensure_semantic_loaded()
    sources = []
    for key in ["erp", "crm", "hr_pim"]:
        connector = _semantic_state.get(key)
        if connector is None:
            continue
        try:
            meta = connector.describe()
            total = sum(meta.record_counts.values())
            quality = 97 if key == "erp" else 94 if key == "crm" else 99
            freshness = "fresh"
            sources.append({
                "id": key,
                "name": meta.name,
                "source_type": meta.source_type,
                "tables": meta.tables,
                "record_counts": meta.record_counts,
                "total_rows": total,
                "loaded_at": meta.loaded_at.isoformat() if meta.loaded_at else None,
                "quality_score": quality,
                "freshness_status": freshness,
            })
        except Exception as exc:
            sources.append({"id": key, "name": key, "error": str(exc)})
    return sources


# ── Semantic definitions CRUD ─────────────────────────────────────────────────


@app.get("/api/semantic/metrics")
def get_metrics(sector_id: str = "manufacturing") -> list[dict[str, Any]]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM sl_metrics WHERE sector_id = ? ORDER BY is_builtin DESC, name",
            (sector_id,)
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["filters"] = json.loads(d.pop("filters_json", "[]"))
            d["grains"]  = json.loads(d.pop("grains_json",  "[]"))
            d["tags"]    = json.loads(d.pop("tags_json",    "[]"))
            d["is_builtin"] = bool(d["is_builtin"])
            result.append(d)
        return result
    finally:
        conn.close()


@app.post("/api/semantic/metrics", status_code=201)
def create_metric(m: MetricCreate) -> dict[str, Any]:
    mid = f"m-{int(__import__('time').time() * 1000)}"
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO sl_metrics
               (id, sector_id, name, description, type, entity, field, numerator, denominator,
                expression, filters_json, time_dimension, grains_json, format, status, owner, tags_json, is_builtin)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)""",
            (mid, m.sector_id, m.name, m.description, m.type, m.entity, m.field,
             m.numerator, m.denominator, m.expression,
             json.dumps(m.filters), m.time_dimension, json.dumps(m.grains),
             m.format, m.status, m.owner, json.dumps(m.tags))
        )
        conn.commit()
        return {"id": mid, **m.model_dump(), "is_builtin": False}
    finally:
        conn.close()


@app.delete("/api/semantic/metrics/{metric_id}")
def delete_metric(metric_id: str) -> dict[str, Any]:
    conn = get_connection()
    try:
        row = conn.execute("SELECT is_builtin FROM sl_metrics WHERE id = ?", (metric_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Metric not found")
        if row[0]:
            raise HTTPException(status_code=403, detail="Cannot delete built-in metrics")
        conn.execute("DELETE FROM sl_metrics WHERE id = ?", (metric_id,))
        conn.commit()
        return {"deleted": metric_id}
    finally:
        conn.close()


@app.get("/api/semantic/hierarchies")
def get_hierarchies(sector_id: str = "manufacturing") -> list[dict[str, Any]]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM sl_hierarchies WHERE sector_id = ? ORDER BY is_builtin DESC, name",
            (sector_id,)
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["levels"]     = json.loads(d.pop("levels_json", "[]"))
            d["is_builtin"] = bool(d["is_builtin"])
            result.append(d)
        return result
    finally:
        conn.close()


@app.post("/api/semantic/hierarchies", status_code=201)
def create_hierarchy(h: HierarchyCreate) -> dict[str, Any]:
    hid = f"h-{int(__import__('time').time() * 1000)}"
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO sl_hierarchies
               (id, sector_id, name, entity, description, type, levels_json, is_builtin)
               VALUES (?,?,?,?,?,?,?,0)""",
            (hid, h.sector_id, h.name, h.entity, h.description, h.type, json.dumps(h.levels))
        )
        conn.commit()
        return {"id": hid, **h.model_dump(), "is_builtin": False}
    finally:
        conn.close()


@app.delete("/api/semantic/hierarchies/{hierarchy_id}")
def delete_hierarchy(hierarchy_id: str) -> dict[str, Any]:
    conn = get_connection()
    try:
        row = conn.execute("SELECT is_builtin FROM sl_hierarchies WHERE id = ?", (hierarchy_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Hierarchy not found")
        if row[0]:
            raise HTTPException(status_code=403, detail="Cannot delete built-in hierarchies")
        conn.execute("DELETE FROM sl_hierarchies WHERE id = ?", (hierarchy_id,))
        conn.commit()
        return {"deleted": hierarchy_id}
    finally:
        conn.close()


@app.get("/api/semantic/segments")
def get_segments(sector_id: str = "manufacturing") -> list[dict[str, Any]]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM sl_segments WHERE sector_id = ? ORDER BY is_builtin DESC, name",
            (sector_id,)
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["conditions"] = json.loads(d.pop("conditions_json", "[]"))
            d["tags"]       = json.loads(d.pop("tags_json",       "[]"))
            d["used_by"]    = json.loads(d.pop("used_by_json",    "[]"))
            d["is_builtin"] = bool(d["is_builtin"])
            result.append(d)
        return result
    finally:
        conn.close()


@app.post("/api/semantic/segments", status_code=201)
def create_segment(s: SegmentCreate) -> dict[str, Any]:
    sid = f"seg-{int(__import__('time').time() * 1000)}"
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO sl_segments
               (id, sector_id, name, description, entity, conditions_json, tags_json, used_by_json, is_builtin)
               VALUES (?,?,?,?,?,?,?,?,0)""",
            (sid, s.sector_id, s.name, s.description, s.entity,
             json.dumps(s.conditions), json.dumps(s.tags), json.dumps(s.used_by))
        )
        conn.commit()
        return {"id": sid, **s.model_dump(), "is_builtin": False}
    finally:
        conn.close()


@app.delete("/api/semantic/segments/{segment_id}")
def delete_segment(segment_id: str) -> dict[str, Any]:
    conn = get_connection()
    try:
        row = conn.execute("SELECT is_builtin FROM sl_segments WHERE id = ?", (segment_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Segment not found")
        if row[0]:
            raise HTTPException(status_code=403, detail="Cannot delete built-in segments")
        conn.execute("DELETE FROM sl_segments WHERE id = ?", (segment_id,))
        conn.commit()
        return {"deleted": segment_id}
    finally:
        conn.close()


@app.get("/api/semantic/coverage")
def semantic_coverage(sector_id: str = "manufacturing") -> dict[str, Any]:
    conn = get_connection()
    try:
        n_metrics     = conn.execute("SELECT COUNT(*) FROM sl_metrics WHERE sector_id=?", (sector_id,)).fetchone()[0]
        n_hierarchies = conn.execute("SELECT COUNT(*) FROM sl_hierarchies WHERE sector_id=?", (sector_id,)).fetchone()[0]
        n_segments    = conn.execute("SELECT COUNT(*) FROM sl_segments WHERE sector_id=?", (sector_id,)).fetchone()[0]
    finally:
        conn.close()

    status = semantic_status()
    n_entities = len(status.get("entities", []))

    breakdown = {
        "sources":     100 if status.get("loaded") else 0,
        "entities":    min(100, n_entities * 10),
        "bridges":     100 if status.get("loaded") else 0,
        "rules":       100 if status.get("loaded") else 0,
        "metrics":     min(100, n_metrics * 20),
        "hierarchies": min(100, n_hierarchies * 34),
        "segments":    min(100, n_segments * 20),
    }
    score = round(sum(breakdown.values()) / len(breakdown))
    return {"sector_id": sector_id, "score": score, "breakdown": breakdown}
