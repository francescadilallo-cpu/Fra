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

    def test_begin_run_is_atomic_guard(self):
        store = PipelineRunStore()
        first = store.begin_run()
        assert first is not None
        # A second reservation while the first is running is refused.
        assert store.begin_run() is None
        first.complete()
        # Once finished, a new run can be reserved again.
        second = store.begin_run()
        assert second is not None and second is not first


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


class TestKGContextMetrics:
    def test_adds_metric_node(self):
        kg = KnowledgeGraph()
        added = kg.ingest_context_metrics([{"name": "Churn rate", "unit": "%"}])
        assert added == 1
        assert any(
            nid == "Metric:Churn rate" and attrs.get("entity_type") == "Metric"
            for nid, attrs in kg.all_nodes()
        )

    def test_grounds_to_measured_table(self):
        kg = KnowledgeGraph()
        kg.ingest_manual_relations(
            [{"from_table": "customers", "to_table": "orders", "edge_type": "FK"}]
        )
        kg.ingest_context_metrics([{"name": "Customer count", "unit": ""}])
        assert any(
            s == "Metric:Customer count"
            and d.split(":")[0] == "customers"
            and data.get("type") == "MEASURES"
            for s, d, data in kg.iter_edges()
        )

    def test_idempotent_node(self):
        kg = KnowledgeGraph()
        kg.ingest_context_metrics([{"name": "Revenue"}])
        assert kg.ingest_context_metrics([{"name": "Revenue"}]) == 0

    def test_skips_empty(self):
        kg = KnowledgeGraph()
        assert kg.ingest_context_metrics([{"name": ""}, {}]) == 0


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


# ── Stage 1-3 enrichments: aliases, value-overlap FK, richer proposal ─────────


class _FakeMgr:
    """Minimal source manager for build_from_schema value-overlap tests."""

    def __init__(self, schema: dict, data: dict):
        self._schema = schema
        self._data = data

    def get_schema_info(self):
        return self._schema

    def execute(self, sql, *a, **kw):
        import re as _re

        m = _re.search(r'"(\w+)" AS v FROM "(\w+)"', sql)
        if not m:
            return []
        col, table = m.group(1), m.group(2)
        return [{"v": v} for v in self._data.get((table, col), set())]


class TestKGAliases:
    def test_attach_aliases_adds_and_dedups(self):
        kg = KnowledgeGraph()
        kg.ingest_manual_relations(
            [{"from_table": "customers", "to_table": "orders", "edge_type": "FK"}]
        )
        assert kg.attach_aliases({"customers": ["clients", "accounts"]}) == 2
        syn = next(
            a.get("synonyms")
            for _n, a in kg.all_nodes()
            if a.get("table") == "customers"
        )
        assert "clients" in syn and "accounts" in syn
        assert kg.attach_aliases({"customers": ["clients"]}) == 0  # dedup
        assert kg.attach_aliases({"ghost": ["x"]}) == 0  # unknown label ignored

    def test_glossary_alias_by_definition(self):
        kg = KnowledgeGraph()
        kg.ingest_manual_relations(
            [{"from_table": "customers", "to_table": "orders", "edge_type": "FK"}]
        )
        n = kg.ingest_glossary_aliases(
            [{"term": "accounts", "definition": "our customers in the CRM"}]
        )
        assert n == 1
        syn = next(
            a.get("synonyms")
            for _n, a in kg.all_nodes()
            if a.get("table") == "customers"
        )
        assert "accounts" in syn
        # A term that already names a node is skipped.
        assert (
            kg.ingest_glossary_aliases(
                [{"term": "customers", "definition": "the customers table"}]
            )
            == 0
        )


class TestValueOverlapFK:
    schema = {
        "orders": {"columns": [{"name": "account_id", "type": "int"}]},
        "customers": {
            "columns": [{"name": "id", "type": "int"}, {"name": "name", "type": "str"}]
        },
    }

    def test_detects_cross_name_fk(self):
        data = {
            ("orders", "account_id"): {1, 2, 3, 4, 5},
            ("customers", "id"): {1, 2, 3, 4, 5, 6},
        }
        kg = KnowledgeGraph()
        kg.build_from_schema(_FakeMgr(self.schema, data))
        edges = {
            (s.split(":")[0], d.split(":")[0], dd.get("type"))
            for s, d, dd in kg.iter_edges()
        }
        assert ("orders", "customers", "FK_account_id") in edges

    def test_no_overlap_no_edge(self):
        data = {
            ("orders", "account_id"): {91, 92, 93, 94, 95},
            ("customers", "id"): {1, 2, 3, 4, 5, 6},
        }
        kg = KnowledgeGraph()
        kg.build_from_schema(_FakeMgr(self.schema, data))
        assert not any(
            dd.get("type") == "FK_account_id" for _s, _d, dd in kg.iter_edges()
        )

    def test_low_cardinality_skipped(self):
        # Only 2 distinct values: a generic small-domain code, not a FK.
        data = {("orders", "account_id"): {1, 2}, ("customers", "id"): {1, 2, 3, 4}}
        kg = KnowledgeGraph()
        kg.build_from_schema(_FakeMgr(self.schema, data))
        assert not any(
            dd.get("type") == "FK_account_id" for _s, _d, dd in kg.iter_edges()
        )

    def test_ambiguous_overlap_skipped(self):
        # account_id values fully overlap TWO tables' PKs → generic shared
        # domain, not a real FK; no edge should be created to either.
        schema = {
            "orders": {"columns": [{"name": "account_id", "type": "int"}]},
            "customers": {"columns": [{"name": "id", "type": "int"}]},
            "regions": {"columns": [{"name": "id", "type": "int"}]},
        }
        data = {
            ("orders", "account_id"): {1, 2, 3, 4, 5},
            ("customers", "id"): {1, 2, 3, 4, 5, 6},
            ("regions", "id"): {1, 2, 3, 4, 5, 7},
        }
        kg = KnowledgeGraph()
        kg.build_from_schema(_FakeMgr(schema, data))
        assert not any(
            dd.get("type") == "FK_account_id" for _s, _d, dd in kg.iter_edges()
        )


class TestProposalEnrichment:
    def test_sanitize_includes_synonyms(self):
        from app.semantic.analyzer import _sanitize_proposal

        raw = {
            "entities": [
                {"table": "t", "name": "T", "synonyms": ["a", "b"], "confidence": 0.9}
            ],
            "metrics": [],
            "relations": [],
        }
        out = _sanitize_proposal(raw, {"t"})
        assert out["entities"][0]["synonyms"] == ["a", "b"]

    def test_formula_refs_validation(self):
        from app.semantic.apply import _formula_refs_ok

        cols = {"orders": {"id", "total"}}
        assert _formula_refs_ok("SUM(orders.total)", cols) is True
        assert _formula_refs_ok("SUM(orders.ghost)", cols) is False
        assert _formula_refs_ok("SUM(unknown.x)", cols) is True  # unknown table skipped

    def test_proposal_entity_aliases(self):
        from app.semantic.apply import _proposal_entity_aliases

        prop = {
            "entities": [
                {"table": "customers", "synonyms": ["clients", "accounts"]},
                {"table": "orders", "synonyms": []},
            ]
        }
        assert _proposal_entity_aliases(prop) == {"customers": ["clients", "accounts"]}


class TestDraftEntityDedupe:
    def test_business_entity_wins_and_inherits_columns(self):
        from app.main import _dedupe_draft_entities

        entities = [
            {
                "name": "sales_order_header",
                "table": "sales_order_header",
                "columns": ["id", "total_due"],
                "column_types": {"id": "int"},
            },
            {"name": "SalesOrder", "table": "sales_order_header", "columns": []},
            {"name": "customers", "table": "customers", "columns": ["id"]},
        ]
        out = _dedupe_draft_entities(entities)
        assert [e["name"] for e in out] == ["SalesOrder", "customers"]
        # Business twin had no columns → inherits them from the schema twin.
        assert out[0]["columns"] == ["id", "total_due"]
        assert out[0]["column_types"] == {"id": "int"}

    def test_no_duplicates_passthrough(self):
        from app.main import _dedupe_draft_entities

        entities = [{"name": "a", "table": "a", "columns": ["x"]}]
        assert _dedupe_draft_entities(entities) == entities


class TestVerifierEntityNameRelations:
    def test_relation_by_entity_name_not_flagged(self):
        from app.agentic.verifier import verify_model

        draft = {
            "entities": [
                {
                    "name": "SalesOrder",
                    "table": "sales_order_header",
                    "columns": ["id"],
                },
                {"name": "Customer", "table": "account", "columns": ["id"]},
            ],
            # Ontology-built KGs emit relations keyed by entity NAME.
            "relations": [
                {
                    "from_table": "SalesOrder",
                    "to_table": "Customer",
                    "edge_type": "PLACED_BY",
                }
            ],
            "metrics": [],
            "templates": [],
        }
        report = verify_model(draft)
        kinds = [w.get("type") for w in report.get("warnings", [])]
        assert "relation_unknown_table" not in kinds


class TestRuleBasedIntegrateFallback:
    _draft = {
        "entities": [
            {"name": "erp_orders", "table": "erp_orders", "columns": ["total"]},
            {"name": "Accounts", "table": "crm_accounts", "columns": ["id"]},
        ]
    }

    def test_link_with_spaces_and_entity_name(self):
        from app.semantic.integrate import interpret_instruction

        out = interpret_instruction(
            "link erp orders to Accounts via account_id", self._draft
        )
        assert out["llm_used"] is False
        assert out["ops"] == [
            {
                "op": "add_relation",
                "from_table": "erp_orders",
                "to_table": "crm_accounts",
                "via_column": "account_id",
            }
        ]

    def test_add_metric(self):
        from app.semantic.integrate import interpret_instruction

        out = interpret_instruction(
            "add a revenue metric = SUM(erp_orders.total)", self._draft
        )
        assert out["ops"][0]["op"] == "add_metric"
        assert out["ops"][0]["name"] == "revenue"
        assert out["ops"][0]["formula"] == "SUM(erp_orders.total)"

    def test_unknown_table_yields_no_ops(self):
        from app.semantic.integrate import interpret_instruction

        out = interpret_instruction("link ghosts to Accounts via x", self._draft)
        assert out["ops"] == []


class TestSameAsCoverageCheck:
    def _runner(self, missing_by_query: dict):
        def run(sql: str):
            for key, n in missing_by_query.items():
                if key in sql:
                    return [{"n": n}]
            return [{"n": 0}]

        return run

    _draft = {
        "entities": [
            {"name": "crm_accounts", "table": "crm_accounts", "columns": ["id"]},
            {
                "name": "legacy_customers",
                "table": "legacy_customers",
                "columns": ["id"],
            },
        ],
        "metrics": [],
        "templates": [],
        "relations": [
            {
                "from_table": "crm_accounts",
                "to_table": "legacy_customers",
                "edge_type": "SAME_AS",
            },
        ],
    }
    _schema = {
        "crm_accounts": {"columns": [{"name": "id"}]},
        "legacy_customers": {"columns": [{"name": "id"}]},
    }

    def test_gap_reported_as_advisory(self):
        report = verify_model(
            self._draft,
            schema_info=self._schema,
            query_runner=self._runner({'(SELECT "id" FROM "legacy_customers"': 1}),
        )
        gaps = [
            a for a in report["advisory"] if a.get("type") == "same_as_coverage_gap"
        ]
        assert len(gaps) == 1
        assert "1 record(s) of 'legacy_customers' are missing" in gaps[0]["detail"]
        assert report["ok"] is True  # advisory only — never blocks

    def test_full_coverage_no_advisory(self):
        report = verify_model(
            self._draft,
            schema_info=self._schema,
            query_runner=self._runner({}),
        )
        assert not [
            a for a in report["advisory"] if a.get("type") == "same_as_coverage_gap"
        ]


class TestFailedSourcesReport:
    def test_lists_errored_non_default_sources(self, monkeypatch):
        from app.connectors.source_registry import SourceConfig
        from app.pipeline import orchestrator as orch

        good = SourceConfig(id="g", connector_type="csv", label="Good", status="active")
        bad = SourceConfig(
            id="b",
            connector_type="csv",
            label="Broken",
            status="error",
            error_msg="CSV not found: /x.csv",
        )
        demo_bad = SourceConfig(
            id="d",
            connector_type="csv",
            label="Demo",
            status="error",
            is_default=True,
            error_msg="whatever",
        )

        class _Reg:
            def list(self):
                return [good, bad, demo_bad]

        monkeypatch.setattr(
            "app.connectors.source_registry.get_source_registry", lambda: _Reg()
        )
        out = orch._failed_sources()
        # Only the user-added errored source — active and demo excluded.
        assert out == [{"id": "b", "label": "Broken", "error": "CSV not found: /x.csv"}]

    def test_degrades_when_registry_unavailable(self, monkeypatch):
        from app.pipeline import orchestrator as orch

        def _boom():
            raise RuntimeError("no registry")

        monkeypatch.setattr("app.connectors.source_registry.get_source_registry", _boom)
        assert orch._failed_sources() == []


class TestMetricOnMergedEntity:
    _rels = [
        {
            "from_table": "crm_accounts",
            "to_table": "legacy_customers",
            "edge_type": "SAME_AS",
        },
    ]

    def test_metric_on_merged_table_flagged(self):
        from app.agentic.verifier import _check_metrics_on_merged

        metrics = [{"name": "Total value", "formula": "SUM(crm_accounts.value)"}]
        notes = _check_metrics_on_merged(metrics, self._rels)
        assert len(notes) == 1
        assert notes[0]["type"] == "metric_on_merged_entity"
        assert notes[0]["severity"] == "info"
        assert "legacy_customers" in notes[0]["detail"]

    def test_metric_on_unmerged_table_not_flagged(self):
        from app.agentic.verifier import _check_metrics_on_merged

        metrics = [{"name": "Order total", "formula": "SUM(orders.total)"}]
        assert _check_metrics_on_merged(metrics, self._rels) == []

    def test_no_relations_no_notes(self):
        from app.agentic.verifier import _check_metrics_on_merged

        metrics = [{"name": "X", "formula": "SUM(crm_accounts.value)"}]
        assert _check_metrics_on_merged(metrics, []) == []
