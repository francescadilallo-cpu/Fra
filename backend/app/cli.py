"""fra CLI — Semantic Layer command-line interface.

Commands
--------
load --scenario PATH   Load all 3 sources, build KG, populate metadata.
ask "question"         Ask a NL question; print answer + provenance.
report                 Run all 25 golden questions; generate eval_report.md.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

# ── bootstrap helpers ─────────────────────────────────────────────────────────


def _build_stack(scenario_path: Path):
    """Load all connectors, build KG, populate catalog, return (erp, crm, hr_pim, kg, catalog, layer)."""
    from app.connectors.postgres_connector import PostgresConnector
    from app.connectors.sqlite_connector import SQLiteConnector
    from app.connectors.file_connector import FileConnector
    from app.ontology.ontology import Ontology
    from app.kg.graph import KnowledgeGraph
    from app.metadata.catalog import MetadataCatalog
    from app.semantic.layer import SemanticLayer
    from app.context.manager import ContextManager

    erp = PostgresConnector(scenario_path / "erp_postgres" / "orion_sales_dump.sql")
    crm = SQLiteConnector(scenario_path / "crm_sqlite" / "clienthub.db")
    hr_pim = FileConnector(
        hr_csv_path=scenario_path / "hr_pim_files" / "dipendenti_hr.csv",
        pim_json_path=scenario_path / "hr_pim_files" / "product_catalog_pim.json",
    )

    ontology_path = scenario_path / "ontology_example.yaml"
    ontology = Ontology.load(ontology_path) if ontology_path.exists() else None

    kg = KnowledgeGraph()
    kg.build(erp, crm, hr_pim)

    catalog = MetadataCatalog()
    catalog.populate([erp, crm, hr_pim], ontology, kg)

    ctx_mgr = ContextManager()
    layer = SemanticLayer(ontology, kg, catalog, ctx_mgr)
    layer.set_connectors(erp, crm, hr_pim)

    return erp, crm, hr_pim, kg, catalog, layer


def _print_summary(erp, crm, hr_pim, kg, catalog) -> None:
    erp_meta = erp.describe()
    crm_meta = crm.describe()
    hr_meta = hr_pim.describe()

    print("\n" + "=" * 60)
    print("  Fra Semantic Layer — Load Summary")
    print("=" * 60)

    print("\n[Sources]")
    for meta in (erp_meta, crm_meta, hr_meta):
        print(
            f"  {meta.name} ({meta.source_type}): {sum(meta.record_counts.values())} rows"
        )

    print("\n[Knowledge Graph]")
    print(f"  Nodes : {kg.node_count}")
    print(f"  Edges : {kg.edge_count}")
    print(f"  Dedup : {kg.dedup_count} duplicate accounts merged")

    print("\n[Metadata Catalog]")
    entities = catalog.list_entities()
    metrics = catalog.list_metrics()
    print(f"  Entities : {entities}")
    print(f"  Metrics  : {metrics}")
    print(f"  Total rows: {catalog.row_count()}")
    print()


# ── commands ──────────────────────────────────────────────────────────────────


def cmd_load(args) -> None:
    scenario = Path(args.scenario).expanduser().resolve()
    if not scenario.exists():
        print(f"ERROR: scenario path not found: {scenario}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading scenario from: {scenario}")
    erp, crm, hr_pim, kg, catalog, _ = _build_stack(scenario)
    _print_summary(erp, crm, hr_pim, kg, catalog)


def cmd_ask(args) -> None:
    from app.semantic.layer import AmbiguityError

    scenario = Path(args.scenario).expanduser().resolve()
    if not scenario.exists():
        print(f"ERROR: scenario path not found: {scenario}", file=sys.stderr)
        sys.exit(1)

    print("Loading scenario…", flush=True)
    erp, crm, hr_pim, kg, catalog, layer = _build_stack(scenario)
    question = args.question

    print(f"\nQ: {question}")
    print("-" * 60)
    try:
        result = layer.ask(question)
        _print_result(result)
    except AmbiguityError as e:
        print(f"AMBIGUITY: {e}")
        print(f"Candidates: {e.candidates}")


def _print_result(result) -> None:

    answer = result.answer
    if isinstance(answer, (list, dict)):
        print(
            f"Answer:\n{json.dumps(answer, indent=2, default=str, ensure_ascii=False)}"
        )
    else:
        print(f"Answer: {answer}")
    if result.sql_used:
        print(f"\nSQL: {result.sql_used.strip()}")
    print(f"Sources: {result.sources_touched}")
    print(f"Latency: {result.latency_ms:.1f} ms")
    if result.disambiguation_required:
        print(f"Disambiguation required: {result.candidates}")
    if result.notes:
        print(f"Notes: {result.notes}")


def cmd_report(args) -> None:
    from app.semantic.layer import AmbiguityError

    scenario = Path(args.scenario).expanduser().resolve()
    if not scenario.exists():
        print(f"ERROR: scenario path not found: {scenario}", file=sys.stderr)
        sys.exit(1)

    gq_path = scenario / "golden_questions.md"
    if not gq_path.exists():
        print("ERROR: golden_questions.md not found", file=sys.stderr)
        sys.exit(1)

    print("Loading scenario…", flush=True)
    erp, crm, hr_pim, kg, catalog, layer = _build_stack(scenario)

    questions = _parse_golden_questions(gq_path.read_text(encoding="utf-8"))
    print(f"Running {len(questions)} golden questions…\n")

    rows = []
    for q_id, level, question in questions:
        t0 = time.perf_counter()
        outcome = "ok"
        notes = ""
        answer = None
        sources = []
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
        except AmbiguityError as e:
            outcome = "ambiguity"
            notes = str(e.candidates)
            disambiguation = True
        except Exception as e:
            outcome = "error"
            notes = str(e)

        latency = round((time.perf_counter() - t0) * 1000, 1)
        rows.append(
            {
                "id": q_id,
                "level": level,
                "question": question[:80],
                "outcome": outcome,
                "latency_ms": latency,
                "sources_touched": ",".join(sources),
                "metadata_present": meta_present,
                "disambiguation": disambiguation,
                "notes": notes[:120],
            }
        )
        icon = "✅" if outcome == "ok" else ("⚠️" if outcome == "ambiguity" else "❌")
        print(f"  {icon} {q_id} ({latency:.0f}ms) — {outcome}")

    # Write eval_report.md
    report_path = (
        Path(args.output)
        if hasattr(args, "output") and args.output
        else Path("eval_report.md")
    )
    _write_report(rows, report_path)
    print(f"\nReport written to: {report_path}")


def _parse_golden_questions(text: str) -> list[tuple[str, int, str]]:
    """Parse golden_questions.md → list of (q_id, level, question_text)."""
    results: list[tuple[str, int, str]] = []
    level = 1
    for line in text.splitlines():
        # Level headers: "## 🟢 Livello 1 — ..."
        lm = re.search(r"Livello\s+(\d+)", line)
        if lm:
            level = int(lm.group(1))
            continue
        # Question lines: "**Q1.** *question text*"
        qm = re.match(r"\*\*(Q\d+)\.\*\*\s+\*(.+?)\*", line)
        if qm:
            q_id = qm.group(1)
            question = qm.group(2).strip()
            results.append((q_id, level, question))
    return results


def _write_report(rows: list[dict], path: Path) -> None:
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
    # Summary
    ok = sum(1 for r in rows if r["outcome"] == "ok")
    ambig = sum(1 for r in rows if r["outcome"] == "ambiguity")
    err = sum(1 for r in rows if r["outcome"] == "error")
    lines += [
        "",
        f"**Total: {len(rows)} questions — ✅ {ok} ok | ⚠️ {ambig} ambiguous | ❌ {err} errors**",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


# ── main ──────────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(prog="fra", description="Fra Semantic Layer CLI")
    parser.add_argument(
        "--scenario",
        default=str(Path(__file__).parent.parent.parent / "test_scenario"),
        help="Path to test scenario directory (default: ../../test_scenario)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # load
    sub.add_parser("load", help="Load sources, build KG, populate metadata")

    # ask
    ask_p = sub.add_parser("ask", help="Ask a natural-language question")
    ask_p.add_argument("question", help="The question to ask")

    # report
    rep_p = sub.add_parser(
        "report", help="Run all 25 golden questions and generate eval_report.md"
    )
    rep_p.add_argument("--output", default="eval_report.md", help="Output file path")

    args = parser.parse_args()
    if args.command == "load":
        cmd_load(args)
    elif args.command == "ask":
        cmd_ask(args)
    elif args.command == "report":
        cmd_report(args)


if __name__ == "__main__":
    main()
