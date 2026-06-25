"""Unit tests for the auto-build pipeline skeleton.

Covers the run state machine (pipeline/runs.py), the apply bridge
(semantic/apply.py) relation/entity logic with a fake catalog, the document
analyser graceful-degrade path (context/doc_analyzer.py), the analyzer priors
block, and the verification stub (agentic/verifier.py). No HTTP / DuckDB needed.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.agentic.verifier import verify_model
from app.context.doc_analyzer import analyze_documents
from app.context.store import ContextStore
from app.kg.graph import KnowledgeGraph
from app.pipeline.runs import STAGE_SEQUENCE, PipelineRun, PipelineRunStore
from app.semantic.analyzer import _priors_block
from app.semantic.apply import _apply_entity_descriptions, _apply_relations
from app.semantic.integrate import _sanitize_ops, apply_ops, interpret_instruction


# ── PipelineRun state machine ─────────────────────────────────────────────────


class TestPipelineRun:
    def test_new_run_has_all_stages_pending(self):
        run = PipelineRun()
        assert [s.name for s in run.stages] == STAGE_SEQUENCE
        assert all(s.state == "pending" for s in run.stages)
        assert run.running is True

    def test_transitions(self):
        run = PipelineRun()
        run.start("context")
        assert run._stage("context").state == "running"
        run.finish("context", "done it")
        s = run._stage("context")
        assert s.state == "done" and s.detail == "done it" and s.finished_at

    def test_complete_ok_when_no_error(self):
        run = PipelineRun()
        for name in STAGE_SEQUENCE:
            run.skip(name)
        run.complete()
        assert run.ok is True
        assert run.running is False

    def test_complete_not_ok_with_error(self):
        run = PipelineRun()
        run.fail("build", "boom")
        run.complete()
        assert run.ok is False

    def test_unknown_stage_raises(self):
        with pytest.raises(KeyError):
            PipelineRun().start("nope")


class TestPipelineRunStore:
    def test_store_tracks_current(self):
        store = PipelineRunStore()
        assert store.current_or_last() is None
        run = store.new_run()
        assert store.current_or_last() is run
        assert store.is_running() is True
        run.complete()
        assert store.is_running() is False


# ── apply bridge ──────────────────────────────────────────────────────────────


class FakeCatalog:
    def __init__(self, entities=None):
        self.relations: list[dict] = []
        self._entities = entities or []
        self.descriptions: dict[str, str] = {}

    def list_manual_relations(self):
        return list(self.relations)

    def add_manual_relation(self, from_table, to_table, via_column="", edge_type="FK"):
        rid = len(self.relations) + 1
        self.relations.append(
            {
                "id": rid,
                "from_table": from_table,
                "to_table": to_table,
                "via_column": via_column,
                "edge_type": edge_type,
            }
        )
        return rid

    def get_draft_entities(self):
        return [dict(e) for e in self._entities]

    def save_entity_draft(self, name, user_description=None, context_notes=None):
        names = {e["name"] for e in self._entities}
        if name not in names:
            return False
        if user_description is not None:
            self.descriptions[name] = user_description
        return True


class TestApplyRelations:
    def test_applies_high_confidence(self):
        cat = FakeCatalog()
        proposal = {
            "relations": [
                {
                    "from_table": "orders",
                    "to_table": "customers",
                    "via_column": "customer_id",
                    "confidence": 0.9,
                },
            ]
        }
        assert _apply_relations(proposal, cat) == 1
        assert cat.relations[0]["edge_type"] == "FK_customer_id"

    def test_skips_low_confidence_and_self_loops(self):
        cat = FakeCatalog()
        proposal = {
            "relations": [
                {"from_table": "a", "to_table": "b", "confidence": 0.2},
                {"from_table": "x", "to_table": "x", "confidence": 0.9},
            ]
        }
        assert _apply_relations(proposal, cat) == 0

    def test_idempotent(self):
        cat = FakeCatalog()
        proposal = {
            "relations": [
                {
                    "from_table": "orders",
                    "to_table": "customers",
                    "via_column": "customer_id",
                    "confidence": 0.9,
                },
            ]
        }
        assert _apply_relations(proposal, cat) == 1
        assert _apply_relations(proposal, cat) == 0  # already present


class TestApplyEntityDescriptions:
    def test_sets_description_matched_by_table(self):
        cat = FakeCatalog(
            entities=[
                {"name": "Customer", "table": "customers", "user_description": ""}
            ]
        )
        proposal = {
            "entities": [
                {"table": "customers", "name": "Cust", "description": "A buyer."}
            ]
        }
        assert _apply_entity_descriptions(proposal, cat) == 1
        assert cat.descriptions["Customer"] == "A buyer."

    def test_does_not_overwrite_existing(self):
        cat = FakeCatalog(
            entities=[
                {"name": "Customer", "table": "customers", "user_description": "mine"}
            ]
        )
        proposal = {"entities": [{"table": "customers", "description": "new"}]}
        assert _apply_entity_descriptions(proposal, cat) == 0


# ── doc analyzer (graceful, no LLM provider configured) ───────────────────────


class TestDocAnalyzer:
    def test_no_documents(self, tmp_path):
        store = ContextStore(db_path=tmp_path / "ctx.db")
        out = analyze_documents(store)
        assert out["doc_count"] == 0 and out["llm_used"] is False

    def test_with_document_no_llm(self, tmp_path):
        store = ContextStore(db_path=tmp_path / "ctx.db")
        store.add_document("notes.txt", "Revenue is sales minus returns.", "txt")
        out = analyze_documents(store)
        # No LLM provider in the test env → graceful empty priors, still counts.
        assert out["doc_count"] == 1
        assert out["glossary"] == [] and out["entities"] == []


# ── analyzer priors block ─────────────────────────────────────────────────────


class TestPriorsBlock:
    def test_empty(self):
        assert _priors_block(None) == ""
        assert _priors_block({}) == ""

    def test_renders_hints(self):
        block = _priors_block(
            {
                "domain": "retail",
                "glossary": [{"term": "GMV", "definition": "gross merch value"}],
                "entities": [{"name": "Order"}],
                "metrics": [{"name": "Revenue"}],
            }
        )
        assert "retail" in block and "GMV" in block and "Order" in block


# ── verification stub ─────────────────────────────────────────────────────────


class TestVerifier:
    def test_flags_relation_to_unknown_table(self):
        draft = {
            "entities": [{"name": "Order", "table": "orders", "columns": ["id"]}],
            "metrics": [],
            "relations": [{"from_table": "orders", "to_table": "ghost"}],
        }
        report = verify_model(draft)
        assert report["ok"] is False
        assert any(w["type"] == "relation_unknown_table" for w in report["warnings"])

    def test_clean_draft_ok(self):
        draft = {
            "entities": [{"name": "Order", "table": "orders", "columns": ["id"]}],
            "metrics": [],
            "relations": [{"from_table": "orders", "to_table": "orders"}],
        }
        report = verify_model(draft)
        assert report["ok"] is True


# ── verification (schema-aware deep checks) ───────────────────────────────────


class TestVerifierDeep:
    schema = {
        "orders": {"columns": [{"name": "id"}, {"name": "total"}, {"name": "cust_id"}]},
        "customers": {"columns": [{"name": "id"}, {"name": "name"}]},
    }

    def test_metric_unknown_reference(self):
        draft = {
            "entities": [{"name": "Order", "table": "orders", "columns": ["id"]}],
            "metrics": [{"name": "Rev", "formula": "SUM(orders.ghost)"}],
            "relations": [],
        }
        report = verify_model(draft, schema_info=self.schema)
        assert any(w["type"] == "metric_unknown_reference" for w in report["warnings"])

    def test_relation_unknown_column(self):
        draft = {
            "entities": [
                {"name": "Order", "table": "orders", "columns": ["id"]},
                {"name": "Customer", "table": "customers", "columns": ["id"]},
            ],
            "metrics": [],
            "relations": [
                {"from_table": "orders", "to_table": "customers", "via_column": "nope"}
            ],
        }
        report = verify_model(draft, schema_info=self.schema)
        assert any(w["type"] == "relation_unknown_column" for w in report["warnings"])

    def test_duplicate_entity_table(self):
        draft = {
            "entities": [
                {"name": "Order", "table": "orders", "columns": ["id"]},
                {"name": "Sale", "table": "orders", "columns": ["id"]},
            ],
            "metrics": [],
            "relations": [],
        }
        report = verify_model(draft)
        assert any(w["type"] == "duplicate_entity_table" for w in report["warnings"])

    def test_template_replay_flags_failures(self):
        draft = {
            "entities": [],
            "metrics": [],
            "relations": [],
            "templates": [
                {"name": "good", "sql_query": "SELECT 1"},
                {"name": "bad", "sql_query": "SELECT {limit} FROM nope"},
            ],
        }

        def runner(sql: str):
            if "nope" in sql:
                raise RuntimeError("no such table: nope")

        report = verify_model(draft, query_runner=runner)
        assert report["summary"]["templates_tested"] == 2
        failed = [w for w in report["warnings"] if w["type"] == "template_query_failed"]
        assert len(failed) == 1 and "bad" in failed[0]["detail"]

    def test_faithfulness_low_score_warns(self):
        draft = {"entities": [], "metrics": [], "relations": []}
        answers = {"q1": {"sql_used": "SELECT 1"}, "q2": {}, "q3": {}}
        report = verify_model(
            draft,
            answer_runner=lambda q: answers.get(q, {}),
            questions=["q1", "q2", "q3"],
        )
        assert report["summary"]["faithfulness_sampled"] == 3
        assert report["summary"]["faithfulness_score"] == round(1 / 3, 2)
        assert any(w["type"] == "low_faithfulness" for w in report["warnings"])

    def test_faithfulness_grounded_ok(self):
        answers = {"q1": {"sql_used": "SELECT 1"}, "q2": {"sources_touched": ["t"]}}
        report = verify_model(
            {"entities": [], "metrics": [], "relations": []},
            answer_runner=lambda q: answers.get(q, {}),
            questions=["q1", "q2"],
        )
        assert report["summary"]["faithfulness_score"] == 1.0
        assert not any(w["type"] == "low_faithfulness" for w in report["warnings"])


# ── KG ingestion of applied/manual relations (context → KG) ───────────────────


class TestKGManualRelations:
    def test_creates_nodes_and_tagged_edge(self):
        kg = KnowledgeGraph()
        added = kg.ingest_manual_relations(
            [
                {
                    "from_table": "orders",
                    "to_table": "customers",
                    "via_column": "customer_id",
                    "edge_type": "FK_customer_id",
                }
            ]
        )
        assert added == 1
        assert kg.node_count == 2
        edges = list(kg.iter_edges())
        assert any(
            s.split(":")[0] == "orders"
            and d.split(":")[0] == "customers"
            and data.get("manual") is True
            for s, d, data in edges
        )

    def test_dedups_within_call(self):
        kg = KnowledgeGraph()
        rels = [{"from_table": "a", "to_table": "b", "edge_type": "FK"}] * 2
        assert kg.ingest_manual_relations(rels) == 1

    def test_skips_self_loops_and_empty(self):
        kg = KnowledgeGraph()
        added = kg.ingest_manual_relations(
            [
                {"from_table": "a", "to_table": "a"},
                {"from_table": "", "to_table": "b"},
            ]
        )
        assert added == 0

    def test_reuses_table_node(self):
        kg = KnowledgeGraph()
        kg.ingest_manual_relations(
            [{"from_table": "orders", "to_table": "customers", "edge_type": "FK"}]
        )
        n0 = kg.node_count
        # 'orders' node already exists → only 'products' is added.
        kg.ingest_manual_relations(
            [{"from_table": "orders", "to_table": "products", "edge_type": "FK"}]
        )
        assert kg.node_count == n0 + 1


class TestKGContextEntities:
    def test_adds_concept_node(self):
        kg = KnowledgeGraph()
        added = kg.ingest_context_entities([{"name": "Churn", "synonyms": []}])
        assert added == 1
        assert any(
            nid == "Concept:Churn" and attrs.get("source") == "document"
            for nid, attrs in kg.all_nodes()
        )

    def test_grounds_to_matching_table(self):
        kg = KnowledgeGraph()
        # A data-backed table node (as build_from_schema would create).
        kg.ingest_manual_relations(
            [{"from_table": "customers", "to_table": "orders", "edge_type": "FK"}]
        )
        kg.ingest_context_entities([{"name": "Customer", "synonyms": ["client"]}])
        # DESCRIBES edge Concept:Customer → customers node (singular→plural match).
        assert any(
            s == "Concept:Customer"
            and d.split(":")[0] == "customers"
            and data.get("type") == "DESCRIBES"
            for s, d, data in kg.iter_edges()
        )

    def test_idempotent_node(self):
        kg = KnowledgeGraph()
        kg.ingest_context_entities([{"name": "Churn"}])
        assert kg.ingest_context_entities([{"name": "Churn"}]) == 0

    def test_skips_empty(self):
        kg = KnowledgeGraph()
        assert kg.ingest_context_entities([{"name": ""}, {}]) == 0


# ── conversational integration (interpret + apply ops) ────────────────────────


class TestIntegrate:
    def test_sanitize_filters_invalid(self):
        raw = {
            "ops": [
                {"op": "delete_everything"},  # not allowed
                {
                    "op": "add_relation",
                    "from_table": "orders",
                    "to_table": "orders",
                },  # self-loop
                {
                    "op": "add_relation",
                    "from_table": "orders",
                    "to_table": "customers",
                    "via_column": "cust_id",
                },
                {"op": "add_metric", "name": "Rev"},  # missing formula
                {"op": "add_metric", "name": "Rev", "formula": "SUM(orders.total)"},
            ]
        }
        ops = _sanitize_ops(raw, {"orders", "customers"}, {"Order", "Customer"})
        kinds = [o["op"] for o in ops]
        assert kinds == ["add_relation", "add_metric"]

    def test_sanitize_rejects_unknown_tables(self):
        raw = {"ops": [{"op": "add_relation", "from_table": "a", "to_table": "b"}]}
        assert _sanitize_ops(raw, {"orders"}, set()) == []

    def test_interpret_no_llm(self):
        # No LLM provider configured in test env → graceful empty ops.
        out = interpret_instruction("link orders to customers", {"entities": []})
        assert out["ops"] == [] and out["llm_used"] is False

    def test_apply_ops_relation_and_description(self):
        cat = FakeCatalog(
            entities=[
                {"name": "Customer", "table": "customers", "user_description": ""}
            ]
        )
        ops = [
            {
                "op": "add_relation",
                "from_table": "orders",
                "to_table": "customers",
                "via_column": "cust_id",
            },
            {
                "op": "set_entity_description",
                "entity": "customers",
                "description": "Buyers",
            },
        ]
        result = apply_ops(ops, catalog=cat, sector_id="manufacturing")
        assert result["counts"]["relations"] == 1
        assert result["counts"]["entities"] == 1
        assert cat.descriptions["Customer"] == "Buyers"
