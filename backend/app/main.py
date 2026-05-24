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

from .database import get_connection, get_table_counts, init_db
from .models import (
    DashboardData,
    MappingUpdateRequest,
    MappingsResponse,
    OntologyGraphData,
    PaginatedData,
    QueryRequest,
    QueryResult,
    RecentOrder,
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
