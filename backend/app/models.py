from pydantic import BaseModel
from typing import Any, Optional


# ── Request / Response models ──────────────────────────────────────────────────


class MappingUpdateRequest(BaseModel):
    table: str
    field: str
    ontology_path: str


# ── Dashboard ──────────────────────────────────────────────────────────────────

class RecentOrder(BaseModel):
    id: int
    customer_name: str
    total_value: float
    status: str
    date: str


class DashboardData(BaseModel):
    total_customers: int
    total_products: int
    total_quotes: int
    total_orders: int
    quote_conversion_rate: float
    open_quotes_value: float
    recent_orders: list[RecentOrder]
    data_sources: list[dict[str, Any]]


# ── Ontology graph ─────────────────────────────────────────────────────────────

class OntologyNode(BaseModel):
    id: str
    data: dict[str, Any]
    position: dict[str, float]
    type: Optional[str] = "default"


class OntologyEdge(BaseModel):
    id: str
    source: str
    target: str
    label: Optional[str] = None
    type: Optional[str] = "smoothstep"


class OntologyGraphData(BaseModel):
    nodes: list[OntologyNode]
    edges: list[OntologyEdge]


# ── Mappings ───────────────────────────────────────────────────────────────────

class MappingEntry(BaseModel):
    table: str
    field: str
    ontology_class: str
    ontology_property: str
    field_type: str


class MappingsResponse(BaseModel):
    mappings: list[MappingEntry]
    raw: dict[str, Any]


# ── Paginated data ─────────────────────────────────────────────────────────────

class PaginatedData(BaseModel):
    table: str
    total: int
    page: int
    page_size: int
    data: list[dict[str, Any]]
