from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, Field


# ── Request / Response models ──────────────────────────────────────────────────


class MappingUpdateRequest(BaseModel):
    table: str = Field(min_length=1, max_length=256)
    field: str = Field(min_length=1, max_length=256)
    ontology_path: str = Field(min_length=1, max_length=512)


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


# ── Semantic definitions ───────────────────────────────────────────────────────


class MetricCreate(BaseModel):
    sector_id: str = Field(default="manufacturing", max_length=64)
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=1000)
    type: Literal["sum", "count", "count_distinct", "avg", "ratio", "derived"] = "sum"
    entity: str = Field(default="", max_length=128)
    field: str = Field(default="", max_length=128)
    numerator: str = Field(default="", max_length=256)
    denominator: str = Field(default="", max_length=256)
    expression: str = Field(default="", max_length=512)
    filters: list[Annotated[str, Field(max_length=500)]] = Field(
        default_factory=list, max_length=20
    )
    time_dimension: str = Field(default="", max_length=128)
    grains: list[Annotated[str, Field(max_length=32)]] = Field(
        default_factory=lambda: ["month", "quarter", "year"], max_length=10
    )
    format: Literal["number", "currency", "percentage"] = "number"
    status: Literal["draft", "verified"] = "draft"
    owner: str = Field(default="", max_length=128)
    tags: list[Annotated[str, Field(max_length=128)]] = Field(
        default_factory=list, max_length=20
    )


class HierarchyCreate(BaseModel):
    sector_id: str = Field(default="manufacturing", max_length=64)
    name: str = Field(min_length=1, max_length=128)
    entity: str = Field(default="", max_length=128)
    description: str = Field(default="", max_length=1000)
    type: Literal["time", "categorical"] = "categorical"
    levels: list[dict] = Field(default_factory=list, max_length=20)


class SegmentCreate(BaseModel):
    sector_id: str = Field(default="manufacturing", max_length=64)
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=1000)
    entity: str = Field(default="", max_length=128)
    conditions: list[dict] = Field(default_factory=list, max_length=50)
    tags: list[Annotated[str, Field(max_length=128)]] = Field(
        default_factory=list, max_length=20
    )
    used_by: list[Annotated[str, Field(max_length=128)]] = Field(
        default_factory=list, max_length=50
    )


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    sector_id: str = Field(default="manufacturing", max_length=64)


class AskResult(BaseModel):
    question: str
    interpreted_as: str
    sql_used: Optional[str] = None
    rows: list[dict[str, Any]] = []
    total_rows: int = 0
    summary: str = ""
    sources_touched: list[str] = []
    provenance: dict[str, Any] = {}
    latency_ms: float = 0.0
    disambiguation_required: bool = False
    candidates: list[str] = []
    ambiguity_error: bool = False
    chart_hint: Optional[dict[str, Any]] = None
