"""Unit tests for KnowledgeGraph — kg/graph.py.

Tests core functionality: node/edge management, neighbor traversal,
shortest-path, subgraph, deduplication helpers, and the schema-only
build_from_schema() path (via a minimal mock DuckDB manager).
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock


sys.path.insert(0, str(Path(__file__).parent.parent))

from app.kg.graph import (
    KnowledgeGraph,
    _edge_limit,
    _node_limit,
    _norm_email,
    _norm_name,
    _normalize_table_name,
)


# ── helpers ───────────────────────────────────────────────────────────────────


class TestHelpers:
    def test_normalize_table_name_strips_csv(self):
        assert _normalize_table_name("dipendenti_hr.csv") == "dipendenti_hr"

    def test_normalize_table_name_strips_json(self):
        assert _normalize_table_name("product_catalog.json") == "product_catalog"

    def test_normalize_table_name_no_extension(self):
        assert _normalize_table_name("sales_order_header") == "sales_order_header"

    def test_normalize_table_name_unknown_extension_preserved(self):
        assert _normalize_table_name("myfile.sql") == "myfile"

    def test_norm_email_lowercases_and_strips(self):
        assert _norm_email("  Alice@Example.COM  ") == "alice@example.com"

    def test_norm_email_none(self):
        assert _norm_email(None) is None

    def test_norm_email_empty(self):
        assert _norm_email("") is None

    def test_norm_name_normalizes_whitespace(self):
        assert _norm_name("  John   Doe  ") == "john doe"

    def test_norm_name_none(self):
        assert _norm_name(None) is None


# ── KnowledgeGraph basic operations ──────────────────────────────────────────


class TestKnowledgeGraphBasic:
    def setup_method(self):
        self.kg = KnowledgeGraph()

    def test_empty_graph(self):
        assert self.kg.node_count == 0
        assert self.kg.edge_count == 0
        assert self.kg.dedup_count == 0

    def test_add_node_and_retrieve(self):
        self.kg._add_node(
            "Customer:1",
            entity_type="Customer",
            canonical_id=1,
            data={"name": "Acme Corp", "revenue": 50000},
            provenance=[{"source": "crm", "original_id": 1, "table": "customers"}],
        )
        assert self.kg.node_count == 1
        node = self.kg.get_node("Customer:1")
        assert node is not None
        assert node["entity_type"] == "Customer"
        assert node["name"] == "Acme Corp"

    def test_get_node_missing_returns_none(self):
        assert self.kg.get_node("Customer:999") is None

    def test_add_multiple_nodes(self):
        for i in range(5):
            self.kg._add_node(
                f"Product:{i}",
                entity_type="Product",
                canonical_id=i,
                data={"sku": f"SKU-{i}"},
                provenance=[],
            )
        assert self.kg.node_count == 5

    def test_entity_index(self):
        self.kg._add_node(
            "SalesOrder:42",
            entity_type="SalesOrder",
            canonical_id=42,
            data={},
            provenance=[],
        )
        node_id = self.kg.node_id_for("SalesOrder", 42)
        assert node_id == "SalesOrder:42"

    def test_entity_index_missing_returns_none(self):
        assert self.kg.node_id_for("SalesOrder", 9999) is None


# ── Edge operations ───────────────────────────────────────────────────────────


class TestKnowledgeGraphEdges:
    def setup_method(self):
        self.kg = KnowledgeGraph()
        self.kg._add_node(
            "Customer:1", entity_type="Customer", canonical_id=1, data={}, provenance=[]
        )
        self.kg._add_node(
            "SalesOrder:10",
            entity_type="SalesOrder",
            canonical_id=10,
            data={},
            provenance=[],
        )
        self.kg._add_node(
            "SalesOrder:11",
            entity_type="SalesOrder",
            canonical_id=11,
            data={},
            provenance=[],
        )

    def test_add_edge_creates_connection(self):
        self.kg._add_edge("SalesOrder:10", "Customer:1", "PLACED_BY")
        assert self.kg.edge_count == 1

    def test_add_edge_missing_node_skipped(self):
        self.kg._add_edge("SalesOrder:10", "Customer:999", "PLACED_BY")
        assert self.kg.edge_count == 0

    def test_neighbors_all(self):
        self.kg._add_edge("SalesOrder:10", "Customer:1", "PLACED_BY")
        self.kg._add_edge("SalesOrder:11", "Customer:1", "PLACED_BY")
        result = self.kg.neighbors("SalesOrder:10")
        assert result == ["Customer:1"]

    def test_neighbors_filtered_by_type(self):
        self.kg._add_node(
            "Territory:5",
            entity_type="Territory",
            canonical_id=5,
            data={},
            provenance=[],
        )
        self.kg._add_edge("SalesOrder:10", "Customer:1", "PLACED_BY")
        self.kg._add_edge("SalesOrder:10", "Territory:5", "IN_TERRITORY")
        placed_by = self.kg.neighbors("SalesOrder:10", edge_type="PLACED_BY")
        assert placed_by == ["Customer:1"]
        in_territory = self.kg.neighbors("SalesOrder:10", edge_type="IN_TERRITORY")
        assert in_territory == ["Territory:5"]

    def test_neighbors_missing_node_returns_empty(self):
        assert self.kg.neighbors("DoesNotExist:999") == []


# ── Path finding ──────────────────────────────────────────────────────────────


class TestKnowledgeGraphPath:
    def setup_method(self):
        self.kg = KnowledgeGraph()
        for nid, etype, cid in [
            ("Customer:1", "Customer", 1),
            ("SalesOrder:10", "SalesOrder", 10),
            ("Salesperson:3", "Salesperson", 3),
        ]:
            self.kg._add_node(
                nid, entity_type=etype, canonical_id=cid, data={}, provenance=[]
            )
        self.kg._add_edge("SalesOrder:10", "Customer:1", "PLACED_BY")
        self.kg._add_edge("SalesOrder:10", "Salesperson:3", "SOLD_BY")

    def test_direct_path(self):
        path = self.kg.path("SalesOrder:10", "Customer:1")
        assert path == ["SalesOrder:10", "Customer:1"]

    def test_two_hop_path(self):
        path = self.kg.path("Customer:1", "Salesperson:3")
        assert len(path) == 3

    def test_no_path_returns_empty(self):
        self.kg._add_node(
            "Orphan:99", entity_type="Orphan", canonical_id=99, data={}, provenance=[]
        )
        assert self.kg.path("Customer:1", "Orphan:99") == []

    def test_max_hops_respected(self):
        path = self.kg.path("Customer:1", "Salesperson:3", max_hops=1)
        assert path == []


# ── Subgraph ──────────────────────────────────────────────────────────────────


class TestKnowledgeGraphSubgraph:
    def setup_method(self):
        self.kg = KnowledgeGraph()
        self.kg._add_node(
            "Customer:1", entity_type="Customer", canonical_id=1, data={}, provenance=[]
        )
        self.kg._add_node(
            "Customer:2", entity_type="Customer", canonical_id=2, data={}, provenance=[]
        )
        self.kg._add_node(
            "SalesOrder:10",
            entity_type="SalesOrder",
            canonical_id=10,
            data={},
            provenance=[],
        )

    def test_subgraph_customer_only(self):
        sg = self.kg.subgraph("Customer")
        assert len(sg.nodes) == 2
        assert "SalesOrder:10" not in sg.nodes

    def test_subgraph_unknown_type_empty(self):
        sg = self.kg.subgraph("UnknownType")
        assert len(sg.nodes) == 0

    def test_all_nodes_returns_all(self):
        nodes = self.kg.all_nodes()
        assert len(nodes) == 3

    def test_all_edges_returns_all(self):
        self.kg._add_edge("SalesOrder:10", "Customer:1", "PLACED_BY")
        edges = self.kg.all_edges()
        assert len(edges) == 1


# ── build_from_schema ─────────────────────────────────────────────────────────


class TestBuildFromSchema:
    def _make_mgr(self, schema: dict) -> MagicMock:
        mgr = MagicMock()
        mgr.get_schema_info.return_value = schema
        return mgr

    def test_schema_creates_one_node_per_table(self):
        schema = {
            "orders": {
                "columns": [{"name": "id"}, {"name": "customer_id"}],
                "row_count": 100,
            },
            "customers": {
                "columns": [{"name": "id"}, {"name": "name"}],
                "row_count": 50,
            },
        }
        kg = KnowledgeGraph()
        kg.build_from_schema(self._make_mgr(schema))
        assert kg.node_count == 2

    def test_schema_detects_fk_edge(self):
        schema = {
            "orders": {
                "columns": [{"name": "id"}, {"name": "customer_id"}],
                "row_count": 0,
            },
            "customer": {"columns": [{"name": "id"}], "row_count": 0},
        }
        kg = KnowledgeGraph()
        kg.build_from_schema(self._make_mgr(schema))
        assert kg.edge_count >= 1

    def test_schema_no_fk_no_edge(self):
        schema = {
            "orders": {"columns": [{"name": "id"}, {"name": "amount"}], "row_count": 0},
            "customers": {
                "columns": [{"name": "id"}, {"name": "name"}],
                "row_count": 0,
            },
        }
        kg = KnowledgeGraph()
        kg.build_from_schema(self._make_mgr(schema))
        assert kg.edge_count == 0

    def test_schema_failure_handled_gracefully(self):
        mgr = MagicMock()
        mgr.get_schema_info.side_effect = RuntimeError("DB unreachable")
        kg = KnowledgeGraph()
        kg.build_from_schema(mgr)
        assert kg.node_count == 0


# ── _edge_limit ────────────────────────────────────────────────────────────────


class TestEdgeLimit:
    def test_default_is_100k(self, monkeypatch):
        monkeypatch.delenv("FRA_KG_EDGE_LIMIT", raising=False)
        assert _edge_limit() == 100000

    def test_custom_value(self, monkeypatch):
        monkeypatch.setenv("FRA_KG_EDGE_LIMIT", "250000")
        assert _edge_limit() == 250000

    def test_zero_means_unlimited(self, monkeypatch):
        monkeypatch.setenv("FRA_KG_EDGE_LIMIT", "0")
        assert _edge_limit() == 0

    def test_invalid_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("FRA_KG_EDGE_LIMIT", "lots")
        assert _edge_limit() == 100000

    def test_negative_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("FRA_KG_EDGE_LIMIT", "-10")
        assert _edge_limit() == 100000

    def test_whitespace_stripped(self, monkeypatch):
        monkeypatch.setenv("FRA_KG_EDGE_LIMIT", "  42  ")
        assert _edge_limit() == 42


# ── _node_limit ────────────────────────────────────────────────────────────────


class TestNodeLimit:
    def test_default_is_200k(self, monkeypatch):
        monkeypatch.delenv("FRA_KG_NODE_LIMIT", raising=False)
        assert _node_limit() == 200000

    def test_custom_value(self, monkeypatch):
        monkeypatch.setenv("FRA_KG_NODE_LIMIT", "500")
        assert _node_limit() == 500

    def test_zero_means_unlimited(self, monkeypatch):
        monkeypatch.setenv("FRA_KG_NODE_LIMIT", "0")
        assert _node_limit() == 0

    def test_invalid_falls_back(self, monkeypatch):
        monkeypatch.setenv("FRA_KG_NODE_LIMIT", "many")
        assert _node_limit() == 200000


# ── build_from_ontology node loading (streaming + cap) ──────────────────────────


class _FakeOntology:
    def __init__(self, entities_cfg: dict) -> None:
        self._entities_cfg = entities_cfg


class _FakeMgr:
    """Minimal manager double: schema discovery + streaming row fetch."""

    def __init__(self, table: str, rows: list[dict]) -> None:
        self._table = table
        self._rows = rows
        self.used_iter = False
        self.used_all = False

    def get_schema_info(self) -> dict:
        return {self._table: {"columns": [], "row_count": len(self._rows)}}

    def execute_iter(self, sql: str, params=(), batch_size: int = 10000):
        self.used_iter = True
        yield from self._rows


class _FakeMgrNoIter:
    """Manager double without execute_iter — exercises the execute_all fallback."""

    def __init__(self, table: str, rows: list[dict]) -> None:
        self._table = table
        self._rows = rows

    def get_schema_info(self) -> dict:
        return {self._table: {"columns": [], "row_count": len(self._rows)}}

    def execute_all(self, sql: str, params=()):
        return list(self._rows)


_CFG = {
    "Customer": {
        "sources": [{"table": "customers", "key_field": "id", "source": "crm"}],
        "attributes": {},
    }
}


class TestBuildFromOntologyNodes:
    def test_loads_all_nodes_below_cap(self, monkeypatch):
        monkeypatch.delenv("FRA_KG_NODE_LIMIT", raising=False)
        rows = [{"id": i, "name": f"c{i}"} for i in range(5)]
        mgr = _FakeMgr("customers", rows)
        kg = KnowledgeGraph()
        kg.build_from_ontology(mgr, _FakeOntology(_CFG))
        assert kg.node_count == 5
        assert mgr.used_iter is True  # streamed, not bulk-loaded

    def test_node_cap_truncates(self, monkeypatch):
        monkeypatch.setenv("FRA_KG_NODE_LIMIT", "3")
        rows = [{"id": i, "name": f"c{i}"} for i in range(10)]
        mgr = _FakeMgr("customers", rows)
        kg = KnowledgeGraph()
        kg.build_from_ontology(mgr, _FakeOntology(_CFG))
        assert kg.node_count == 3

    def test_unlimited_loads_all(self, monkeypatch):
        monkeypatch.setenv("FRA_KG_NODE_LIMIT", "0")
        rows = [{"id": i} for i in range(25)]
        mgr = _FakeMgr("customers", rows)
        kg = KnowledgeGraph()
        kg.build_from_ontology(mgr, _FakeOntology(_CFG))
        assert kg.node_count == 25

    def test_fallback_to_execute_all(self, monkeypatch):
        monkeypatch.delenv("FRA_KG_NODE_LIMIT", raising=False)
        rows = [{"id": i} for i in range(4)]
        mgr = _FakeMgrNoIter("customers", rows)
        kg = KnowledgeGraph()
        kg.build_from_ontology(mgr, _FakeOntology(_CFG))
        assert kg.node_count == 4
