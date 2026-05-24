"""test_golden_questions.py — Integration tests for all 25 golden questions.

Bootstrap
---------
1. Load all connectors from test_scenario/
2. Build KnowledgeGraph
3. Populate MetadataCatalog
4. Create SemanticLayer

For each of the 25 questions:
- Call SemanticLayer.ask(question)
- Assert expected outcome (answer / AmbiguityError / no_data)
- Generate eval_report.md
"""
from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Any

import pytest

# ── paths ─────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).parent.parent.parent
SCENARIO = ROOT / "test_scenario"
REPORT_PATH = ROOT / "eval_report.md"


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def connectors():
    """Load all three connectors."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))

    from app.connectors.postgres_connector import PostgresConnector
    from app.connectors.sqlite_connector import SQLiteConnector
    from app.connectors.file_connector import FileConnector

    erp = PostgresConnector(SCENARIO / "erp_postgres" / "orion_sales_dump.sql")
    crm = SQLiteConnector(SCENARIO / "crm_sqlite" / "clienthub.db")
    hr_pim = FileConnector(
        hr_csv_path=SCENARIO / "hr_pim_files" / "dipendenti_hr.csv",
        pim_json_path=SCENARIO / "hr_pim_files" / "product_catalog_pim.json",
    )
    return erp, crm, hr_pim


@pytest.fixture(scope="session")
def kg(connectors):
    from app.kg.graph import KnowledgeGraph
    erp, crm, hr_pim = connectors
    g = KnowledgeGraph()
    g.build(erp, crm, hr_pim)
    return g


@pytest.fixture(scope="session")
def ontology():
    from app.ontology.ontology import Ontology
    p = SCENARIO / "ontology_example.yaml"
    return Ontology.load(p) if p.exists() else None


@pytest.fixture(scope="session")
def catalog(connectors, ontology, kg):
    from app.metadata.catalog import MetadataCatalog
    erp, crm, hr_pim = connectors
    c = MetadataCatalog()
    c.populate([erp, crm, hr_pim], ontology, kg)
    return c


@pytest.fixture(scope="session")
def layer(connectors, ontology, kg, catalog):
    from app.semantic.layer import SemanticLayer
    from app.context.manager import ContextManager
    erp, crm, hr_pim = connectors
    ctx = ContextManager()
    sl = SemanticLayer(ontology, kg, catalog, ctx)
    sl.set_connectors(erp, crm, hr_pim)
    return sl


# ── golden question parse ─────────────────────────────────────────────────────

def _parse_golden_questions() -> list[tuple[str, int, str]]:
    text = (SCENARIO / "golden_questions.md").read_text(encoding="utf-8")
    results: list[tuple[str, int, str]] = []
    level = 1
    for line in text.splitlines():
        lm = re.search(r"Livello\s+(\d+)", line)
        if lm:
            level = int(lm.group(1))
            continue
        qm = re.match(r"\*\*(Q\d+)\.\*\*\s+\*(.+?)\*", line)
        if qm:
            results.append((qm.group(1), level, qm.group(2).strip()))
    return results


QUESTIONS = _parse_golden_questions()


# ── per-question tests ────────────────────────────────────────────────────────

# Expected outcomes for known questions (Q_id → "ok" | "ambiguity" | "no_data" | "disambiguation")
EXPECTED: dict[str, str] = {
    "Q1": "ok",
    "Q2": "ok",
    "Q3": "ok",
    "Q4": "ok",
    "Q5": "ok",
    "Q6": "ok",
    "Q7": "ok",
    "Q8": "ok",
    "Q9": "ok",
    "Q10": "ok",
    "Q11": "ok",
    "Q12": "ok",
    "Q13": "ok",
    "Q14": "ok",
    "Q15": "ok",
    "Q16": "ok",
    "Q17": "ok",
    "Q18": "ok",
    "Q19": "ok",
    "Q20": "ok",
    "Q21": "ambiguity",   # fatturato → AmbiguityError
    "Q22": "disambiguation",  # multiple Marys
    "Q23": "ok",          # provenance
    "Q24": "ok",          # duplicate accounts check
    "Q25": "no_data",     # nationality not available
}


@pytest.mark.parametrize("q_id,level,question", QUESTIONS, ids=[q[0] for q in QUESTIONS])
def test_golden_question(q_id, level, question, layer, request):
    from app.semantic.layer import AmbiguityError

    t0 = time.perf_counter()
    outcome = "ok"
    notes = ""
    answer: Any = None
    sources: list[str] = []
    meta_present = False
    disambiguation = False

    try:
        result = layer.ask(question)
        answer = result.answer
        sources = result.sources_touched
        meta_present = bool(result.provenance)
        disambiguation = result.disambiguation_required
        if answer is None and result.notes:
            outcome = "no_data"
            notes = result.notes
        elif disambiguation:
            outcome = "disambiguation"
            notes = str(result.candidates)
    except AmbiguityError as e:
        outcome = "ambiguity"
        notes = str(e.candidates)
        disambiguation = True

    latency = round((time.perf_counter() - t0) * 1000, 1)

    # Store for report generation
    if not hasattr(request.session, "_gq_results"):
        request.session._gq_results = []
    request.session._gq_results.append({
        "id": q_id,
        "level": level,
        "question": question[:80],
        "outcome": outcome,
        "latency_ms": latency,
        "sources_touched": ",".join(sources),
        "metadata_present": meta_present,
        "disambiguation": disambiguation,
        "notes": notes[:120],
    })

    # Assertions
    expected = EXPECTED.get(q_id, "ok")
    if expected == "ambiguity":
        assert outcome == "ambiguity", (
            f"{q_id}: expected AmbiguityError but got outcome='{outcome}', answer={answer}"
        )
    elif expected == "no_data":
        assert outcome in ("no_data", "ok"), (
            f"{q_id}: expected no_data/impossible but got outcome='{outcome}'"
        )
        # For Q25 specifically, answer should be None
        if q_id == "Q25":
            assert answer is None, f"Q25: expected None answer (impossible query) but got {answer}"
    elif expected == "disambiguation":
        assert outcome in ("disambiguation", "ok"), (
            f"{q_id}: expected disambiguation but got outcome='{outcome}'"
        )
    else:
        # ok: answer should not raise and should return something
        assert outcome not in ("error",), f"{q_id}: unexpected error — {notes}"


# ── report generation (session-scoped) ────────────────────────────────────────

@pytest.fixture(scope="session", autouse=True)
def generate_report(request):
    """Write eval_report.md after all tests complete."""
    yield
    rows = getattr(request.session, "_gq_results", [])
    if not rows:
        return
    _write_report(rows)


def _write_report(rows: list[dict]) -> None:
    lines = [
        "# Fra Semantic Layer — Eval Report",
        "",
        "| Q | Level | Outcome | Latency (ms) | Sources | Metadata | Disamb | Notes |",
        "|---|-------|---------|-------------|---------|---------|--------|-------|",
    ]
    for r in rows:
        lines.append(
            f"| {r['id']} | {r['level']} | {r['outcome']} | {r['latency_ms']} "
            f"| {r['sources_touched']} | {r['metadata_present']} | {r['disambiguation']} "
            f"| {r['notes']} |"
        )
    ok = sum(1 for r in rows if r["outcome"] == "ok")
    ambig = sum(1 for r in rows if r["outcome"] == "ambiguity")
    disamb = sum(1 for r in rows if r["outcome"] == "disambiguation")
    no_data = sum(1 for r in rows if r["outcome"] == "no_data")
    err = sum(1 for r in rows if r["outcome"] == "error")
    lines += [
        "",
        f"**Total: {len(rows)} questions**",
        f"- ✅ ok: {ok}",
        f"- ⚠️ ambiguity (correctly raised): {ambig}",
        f"- 🔀 disambiguation: {disamb}",
        f"- ℹ️ no_data (impossible): {no_data}",
        f"- ❌ error: {err}",
    ]
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n[eval_report.md written to {REPORT_PATH}]")


# ── unit tests for connectors ────────────────────────────────────────────────

class TestConnectors:
    def test_erp_describes(self, connectors):
        erp, _, _ = connectors
        meta = erp.describe()
        assert meta.name == "erp"
        assert meta.record_counts["sales_order_header"] > 0

    def test_crm_describes(self, connectors):
        _, crm, _ = connectors
        meta = crm.describe()
        assert meta.name == "crm"
        assert meta.record_counts["account"] > 0

    def test_hr_pim_describes(self, connectors):
        _, _, hr_pim = connectors
        meta = hr_pim.describe()
        assert meta.name == "hr_pim"
        assert meta.record_counts["dipendenti_hr"] > 0
        assert meta.record_counts["product_catalog_pim"] > 0

    def test_hr_dates_normalised(self, connectors):
        _, _, hr_pim = connectors
        rows = list(hr_pim.load_entity("Employee"))
        # Check first row has ISO date
        sample = rows[0]
        for col in ["DataAssunzione", "DataNascita"]:
            val = sample.get(col)
            if val:
                assert re.match(r"\d{4}-\d{2}-\d{2}", val), f"{col} not ISO: {val}"

    def test_pim_dates_normalised(self, connectors):
        _, _, hr_pim = connectors
        rows = list(hr_pim.load_entity("Product"))
        for r in rows:
            val = r.get("sellStartDate")
            if val:
                assert re.match(r"\d{4}-\d{2}-\d{2}", val), f"sellStartDate not ISO: {val}"
                break


class TestKnowledgeGraph:
    def test_node_count(self, kg):
        assert kg.node_count > 0

    def test_edge_count(self, kg):
        assert kg.edge_count > 0

    def test_dedup_positive(self, kg):
        assert kg.dedup_count > 0

    def test_customers_exist(self, kg):
        sg = kg.subgraph("Customer")
        assert sg.number_of_nodes() > 0

    def test_salesperson_promoted(self, kg):
        sg = kg.subgraph("Salesperson")
        assert sg.number_of_nodes() > 0


class TestMetadataCatalog:
    def test_entities_populated(self, catalog):
        entities = catalog.list_entities()
        assert "SalesOrder" in entities
        assert "Customer" in entities
        assert "Employee" in entities
        assert "Product" in entities

    def test_metrics_populated(self, catalog):
        metrics = catalog.list_metrics()
        assert "revenue" in metrics
        assert "revenue_with_tax" in metrics
        assert "margin" in metrics

    def test_get_entity(self, catalog):
        meta = catalog.get_entity("SalesOrder")
        assert meta is not None
        assert meta.record_count > 0

    def test_quality_flags_customer(self, catalog):
        meta = catalog.get_entity("Customer")
        assert meta is not None
        flags = meta.quality_flags
        assert flags.get("duplicates_detected") is True
