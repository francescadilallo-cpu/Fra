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
from app.pipeline.runs import STAGE_SEQUENCE, PipelineRun, PipelineRunStore
from app.semantic.analyzer import _priors_block
from app.semantic.apply import _apply_entity_descriptions, _apply_relations


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
