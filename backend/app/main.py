"""
SemanticIntelligence – FastAPI application entry point.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

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
