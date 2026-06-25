"""End-to-end integration test for the auto-build pipeline (multi-source).

Seeds two CSV sources with *different data models* (customers + orders, linked by
``orders.customer_id``) into a real DuckDB snapshot, wires them as the
process-wide source manager/registry, then runs the full orchestrator (stages
1-5) and asserts the unified model is actually built:

- both sources become entities,
- the cross-source relation is present in the KG (schema FK inference),
- document-derived Concept/Metric nodes are folded into the graph,
- a verification report is produced and the run succeeds.

No LLM is required: ``analyze`` degrades deterministically and the cross-source
relation comes from FK inference, so this is a stable regression guard for the
core flow.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


def _write_csv(path: Path, lines: list[str]) -> None:
    path.write_text("\n".join(lines) + "\n")


@pytest.fixture()
def pipeline_env(tmp_path, monkeypatch):
    monkeypatch.setenv("FRA_STORAGE_MODE", "snapshot")
    monkeypatch.setenv("SEMANTIC_REQUIRE_LLM_INTENT", "0")
    monkeypatch.setenv("METADATA_DB_URL", f"sqlite:///{tmp_path / 'metadata.db'}")

    # Two sources with different shapes, linked by customer_id.
    customers = tmp_path / "customers.csv"
    _write_csv(customers, ["id,name,segment", "1,Acme,Enterprise", "2,Globex,SMB"])
    orders = tmp_path / "orders.csv"
    _write_csv(orders, ["id,customer_id,total", "10,1,100.0", "11,2,50.0", "12,1,25.0"])

    import app.connectors.duckdb_source_manager as mgr_mod
    import app.connectors.source_registry as reg_mod
    from app.connectors.duckdb_source_manager import DuckDBSourceManager
    from app.connectors.source_registry import SourceConfig

    registry = reg_mod.SourceRegistry(tmp_path / "registry.db")

    def _csv(sid: str, path: Path, table: str) -> SourceConfig:
        return SourceConfig(
            id=sid,
            connector_type="csv",
            label=sid,
            params={"path": str(path), "table_name": table, "delimiter": ","},
            target_tables=[table],
        )

    registry.upsert(_csv("src_cust", customers, "customers"))
    registry.upsert(_csv("src_ord", orders, "orders"))

    scenario = tmp_path / "scenario"
    scenario.mkdir()  # empty → no ontology yaml → schema-build path (the live path)
    mgr = DuckDBSourceManager(scenario, tmp_path / "snap.duckdb", registry)
    counts = mgr.rebuild()
    assert counts.get("src_cust.customers") == 2
    assert counts.get("src_ord.orders") == 3

    # Wire as the process-wide singletons used by the orchestrator.
    monkeypatch.setattr(reg_mod, "_REGISTRY", registry, raising=False)
    monkeypatch.setattr(mgr_mod, "_MANAGER", mgr, raising=False)

    import app.main as m

    monkeypatch.setattr(m, "_SCENARIO_PATH", scenario, raising=False)
    m._semantic_state["loaded"] = False

    # Document-derived context (folded into the KG as Concept/Metric nodes).
    from app.context.store import default_store as ctx

    ent = ctx.add_entity("Customer", "Customer", ["client"], "B2B buyers", "document")
    met = ctx.add_metric(
        "Order total", "Order total", [], "sum of orders", "EUR", False
    )
    try:
        yield m
    finally:
        ctx.delete_entity(ent.id)
        ctx.delete_metric(met.id)
        m._semantic_state["loaded"] = False


def test_pipeline_builds_unified_multisource_model(pipeline_env):
    m = pipeline_env
    from app.pipeline.orchestrator import run_build_pipeline
    from app.pipeline.runs import PipelineRunStore

    run = run_build_pipeline(mode="live", hidden=frozenset(), store=PipelineRunStore())

    states = {s.name: s.state for s in run.stages}
    assert states["context"] == "skipped"  # no documents uploaded
    assert states["sources"] == "done"
    assert states["build"] == "done"
    assert states["integration"] == "done"
    assert states["verification"] == "done"
    assert run.ok is True

    # Unified model: both sources are entities.
    draft = m._get_semantic_draft()
    tables = {e["table"] for e in draft["entities"]}
    assert {"customers", "orders"} <= tables

    # Cross-source relation inferred from orders.customer_id -> customers.
    rel_pairs = {(r["from_table"], r["to_table"]) for r in draft["relations"]}
    assert ("orders", "customers") in rel_pairs

    # Context knowledge folded into the KG.
    kg = m._semantic_state["kg"]
    kinds = {a.get("entity_type") for _, a in kg.all_nodes()}
    assert "Concept" in kinds
    assert "Metric" in kinds

    # Verification ran and produced a report.
    report = run.to_dict()["report"].get("verification")
    assert report is not None and "summary" in report
    # No LLM provider in the test env → faithfulness is skipped (not a spurious
    # low_faithfulness warning from "no LLM" answers).
    assert report["summary"]["faithfulness_sampled"] == 0
    assert not any(w["type"] == "low_faithfulness" for w in report["warnings"])


def test_pipeline_no_sources_degrades(monkeypatch, tmp_path):
    """With no live sources the run still completes, skipping build."""
    monkeypatch.setenv("FRA_STORAGE_MODE", "snapshot")
    monkeypatch.setenv("METADATA_DB_URL", f"sqlite:///{tmp_path / 'meta2.db'}")

    import app.connectors.duckdb_source_manager as mgr_mod
    import app.connectors.source_registry as reg_mod
    from app.connectors.duckdb_source_manager import DuckDBSourceManager

    registry = reg_mod.SourceRegistry(tmp_path / "reg2.db")
    scenario = tmp_path / "scen2"
    scenario.mkdir()
    mgr = DuckDBSourceManager(scenario, tmp_path / "snap2.duckdb", registry)
    mgr.rebuild()
    monkeypatch.setattr(reg_mod, "_REGISTRY", registry, raising=False)
    monkeypatch.setattr(mgr_mod, "_MANAGER", mgr, raising=False)

    import app.main as m

    monkeypatch.setattr(m, "_SCENARIO_PATH", scenario, raising=False)
    m._semantic_state["loaded"] = False

    from app.pipeline.orchestrator import run_build_pipeline
    from app.pipeline.runs import PipelineRunStore

    run = run_build_pipeline(mode="live", hidden=frozenset(), store=PipelineRunStore())
    states = {s.name: s.state for s in run.stages}
    assert states["sources"] == "skipped"
    assert states["build"] == "skipped"
    assert run.ok is True
    m._semantic_state["loaded"] = False
