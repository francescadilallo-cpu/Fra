"""Unit tests for GraphRAG retrieval over the Knowledge Graph (graph_rag.py).

Builds a small KG with table relations + document-derived concepts/metrics and
checks that build_graph_context links the question to the right nodes, renders a
grounded block, respects hidden tables, and degrades on no match.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.kg.graph import KnowledgeGraph
from app.semantic.graph_rag import build_graph_context


def _sample_kg() -> KnowledgeGraph:
    kg = KnowledgeGraph()
    kg.ingest_manual_relations(
        [
            {
                "from_table": "orders",
                "to_table": "customers",
                "via_column": "customer_id",
                "edge_type": "FK_customer_id",
            }
        ]
    )
    kg.ingest_context_entities([{"name": "Customer", "synonyms": ["client"]}])
    kg.ingest_context_metrics([{"name": "Revenue", "unit": "EUR"}])
    return kg


class TestBuildGraphContext:
    def test_links_question_to_nodes(self):
        kg = _sample_kg()
        gr = build_graph_context(kg, "show top customers by revenue")
        labels = {n["label"] for n in gr["nodes"]}
        assert "customers" in labels  # table linked
        assert "Revenue" in labels  # metric linked
        assert gr["context"].startswith("### Knowledge graph context")
        assert "related to" in gr["context"]  # FK relation rendered

    def test_synonym_links_concept(self):
        kg = _sample_kg()
        gr = build_graph_context(kg, "who is our biggest client")
        labels = {n["label"] for n in gr["nodes"]}
        assert "Customer" in labels  # matched via synonym "client"

    def test_hidden_table_excluded(self):
        kg = _sample_kg()
        gr = build_graph_context(
            kg, "show customers and orders", hidden_tables=frozenset({"customers"})
        )
        labels = {n["label"] for n in gr["nodes"]}
        assert "customers" not in labels

    def test_no_match_returns_empty(self):
        kg = _sample_kg()
        gr = build_graph_context(kg, "completely unrelated weather forecast")
        assert gr["context"] == "" and gr["nodes"] == [] and gr["edges"] == []

    def test_none_kg_safe(self):
        gr = build_graph_context(None, "anything")
        assert gr["context"] == ""

    def test_edges_have_shape(self):
        kg = _sample_kg()
        gr = build_graph_context(kg, "orders and customers")
        for e in gr["edges"]:
            assert {"from", "to", "type"} <= set(e)

    def test_returns_relevant_tables_incl_neighbors(self):
        kg = _sample_kg()
        gr = build_graph_context(kg, "show top customers by revenue")
        # 'customers' matched directly; 'orders' pulled in as its FK neighbor.
        assert {"customers", "orders"} <= set(gr["tables"])

    def test_no_match_no_tables(self):
        kg = _sample_kg()
        gr = build_graph_context(kg, "unrelated weather forecast")
        assert gr["tables"] == []

    def test_fuzzy_matches_typo(self):
        kg = _sample_kg()
        # "custmers" (typo) should still link to the customers table.
        gr = build_graph_context(kg, "show custmers")
        assert "customers" in set(gr["tables"])

    def test_fuzzy_does_not_overmatch(self):
        kg = _sample_kg()
        # A clearly unrelated word must not fuzzy-link to any node.
        gr = build_graph_context(kg, "weather")
        assert gr["nodes"] == [] and gr["tables"] == []
