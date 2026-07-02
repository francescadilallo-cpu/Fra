"""The auto-build orchestrator.

Runs the 5-stage flow server-side, updating per-stage status as it goes:

    1. context        — analyse uploaded documents → business priors
    2. sources        — discover the live source tables
    3. build          — propose model (priors-biased) → apply → rebuild KG + SL
                        → regenerate query templates  (AUTO-APPLIED)
    4. integration     — manual/conversational refinement   (STUB hook)
    5. verification    — reliability/consistency agents      (STUB)

Each stage degrades gracefully: a recoverable failure marks that stage ``error``
and the run continues where it still makes sense. Heavy lifting reuses existing
building blocks; this module only sequences them. Imports from ``app.main`` are
done lazily inside the function to avoid an import cycle (main registers the
endpoints that call this).
"""

from __future__ import annotations

import gc
import logging

from .runs import (
    STAGE_BUILD,
    STAGE_CONTEXT,
    STAGE_INTEGRATION,
    STAGE_SOURCES,
    STAGE_VERIFICATION,
    PipelineRun,
    PipelineRunStore,
)

logger = logging.getLogger(__name__)


def run_build_pipeline(
    mode: str,
    hidden: frozenset[str],
    store: PipelineRunStore,
    run: PipelineRun | None = None,
) -> PipelineRun:
    """Execute the auto-build pipeline once and return the completed run.

    *run* may be a run already reserved by the caller (e.g. the endpoint, which
    reserves atomically to avoid concurrent runs). When omitted, one is reserved
    here; if another run is already in progress, the in-flight run is returned
    without starting a second build.
    """
    # Lazy imports — avoid a module-load cycle with app.main.
    from app.main import (  # noqa: PLC0415
        _SCENARIO_PATH,
        _ensure_semantic_loaded,
        _get_semantic_draft,
        _semantic_state,
        reload_semantic,
    )

    # Live mode is always the "manufacturing" default sector (see CLAUDE.md).
    sector_id = "manufacturing"
    if run is None:
        run = store.begin_run()
        if run is None:
            existing = store.current_or_last()
            if existing is not None:
                return existing
            run = store.new_run()
    else:
        store.set_current(run)

    # ── Stage 1: context ─────────────────────────────────────────────────────
    priors: dict = {}
    run.start(STAGE_CONTEXT)
    try:
        from ..context.doc_analyzer import analyze_documents  # noqa: PLC0415
        from ..context.store import default_store as context_store  # noqa: PLC0415

        priors = analyze_documents(context_store, mode=mode)
        if priors.get("doc_count", 0) == 0:
            run.skip(STAGE_CONTEXT, "No context documents uploaded.")
        else:
            run.finish(
                STAGE_CONTEXT,
                f"{priors['doc_count']} docs → "
                f"{len(priors.get('glossary', []))} terms, "
                f"{len(priors.get('entities', []))} entities, "
                f"{len(priors.get('metrics', []))} metrics"
                + ("" if priors.get("llm_used") else " (no LLM)"),
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("pipeline context stage failed: %s", exc, exc_info=True)
        run.fail(STAGE_CONTEXT, str(exc))

    # ── Stage 2: sources ─────────────────────────────────────────────────────
    schema_info: dict = {}
    live_tables: list[str] = []
    mgr = None
    run.start(STAGE_SOURCES)
    try:
        from ..connectors.duckdb_source_manager import (  # noqa: PLC0415
            get_source_manager,
        )

        mgr = get_source_manager(_SCENARIO_PATH)
        schema_info = mgr.get_schema_info()
        # Connector bookkeeping tables (e.g. Salesforce describe catalogs) are
        # not business data — the analyzer must not propose entities for them.
        internal = frozenset(getattr(mgr, "internal_metadata_tables", ()) or ())
        live_tables = [t for t in schema_info if t not in hidden and t not in internal]
        if not live_tables:
            run.skip(STAGE_SOURCES, "No data sources connected.")
        else:
            total_rows = sum(
                int((schema_info[t] or {}).get("row_count") or 0) for t in live_tables
            )
            run.finish(
                STAGE_SOURCES,
                f"{len(live_tables)} source tables · {total_rows:,} rows",
            )
    except Exception as exc:  # noqa: BLE001
        logger.error("pipeline sources stage failed: %s", exc, exc_info=True)
        run.fail(STAGE_SOURCES, str(exc))

    # ── Stage 3: build (auto-applied) ────────────────────────────────────────
    draft: dict = {}
    run.start(STAGE_BUILD)
    if not live_tables:
        run.skip(STAGE_BUILD, "Nothing to build without data sources.")
    else:
        try:
            from ..semantic.analyzer import analyze  # noqa: PLC0415
            from ..semantic.apply import (  # noqa: PLC0415
                apply_proposal,
                merge_proposal_metrics_into_draft,
            )
            from ..semantic.template_generator import (  # noqa: PLC0415
                generate_templates_from_draft,
            )

            # Ensure a catalog exists so we can persist the proposal into it.
            _ensure_semantic_loaded()
            catalog = _semantic_state.get("catalog")

            result = analyze(schema_info, live_tables, priors=priors or None)
            proposal = result.get("proposal", {})
            applied = apply_proposal(
                proposal,
                catalog=catalog,
                sector_id=sector_id,
                schema_info=schema_info,
            )

            # Rebuild KG + Semantic Layer so the applied model takes effect.
            reload_semantic()
            # The previous KG (a cyclic networkx graph) is now unreferenced but
            # not yet reclaimed by refcounting; collect it before the next heavy
            # step to keep peak memory down on small (512 MB) instances.
            gc.collect()

            # Attach the proposed entity synonyms as KG aliases (better NL recall).
            kg = _semantic_state.get("kg")
            if kg is not None and applied.get("entity_aliases"):
                try:
                    kg.attach_aliases(applied["entity_aliases"])
                except Exception as _al_exc:  # noqa: BLE001
                    logger.debug("alias attach skipped: %s", _al_exc)

            # Regenerate query templates from the (proposal-augmented) draft.
            catalog = _semantic_state.get("catalog")
            layer = _semantic_state.get("layer")
            draft = _get_semantic_draft(hidden)
            n_tpl = 0
            if catalog is not None and layer is not None:
                augmented = dict(draft)
                augmented["metrics"] = merge_proposal_metrics_into_draft(
                    draft.get("metrics", []), proposal.get("metrics", [])
                )
                auto_tpls = generate_templates_from_draft(augmented)
                n_tpl = catalog.upsert_auto_templates(auto_tpls)
                layer.set_templates(catalog.list_templates())

            run.report["applied"] = applied
            run.finish(
                STAGE_BUILD,
                f"applied {applied['relations']} relations, "
                f"{applied['metrics']} metrics, {applied['entities']} entity notes; "
                f"{n_tpl} templates" + ("" if result.get("llm_used") else " (no LLM)"),
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("pipeline build stage failed: %s", exc, exc_info=True)
            run.fail(STAGE_BUILD, str(exc))

    # ── Stage 4: integration ─────────────────────────────────────────────────
    # Integration is interactive (manual editor + conversational endpoint), so
    # the batch run just confirms it's enabled rather than performing edits.
    run.finish(
        STAGE_INTEGRATION,
        "Model open for refinement — edit it directly or use 'Refine by instruction'.",
    )

    # ── Stage 5: verification ────────────────────────────────────────────────
    run.start(STAGE_VERIFICATION)
    try:
        from ..agentic.verifier import verify_model  # noqa: PLC0415

        if not draft:
            draft = _get_semantic_draft(hidden)
        # Read-only SQL replay of generated templates against the live data.
        query_runner = None
        if mgr is not None and live_tables:
            query_runner = lambda sql: mgr.execute(sql, limit=1)  # noqa: E731

        # Faithfulness sampling + LLM critique only make sense when a provider is
        # configured. Without one, layer.ask() returns "no LLM" messages that
        # would score as ungrounded — a spurious low_faithfulness warning on every
        # build — so gate both on provider availability (also avoids wasted calls).
        from ..semantic.layer import _llm_intent_provider  # noqa: PLC0415

        llm_available = _llm_intent_provider() is not None
        layer = _semantic_state.get("layer")
        questions = _sample_questions(draft) if llm_available else []
        answer_runner = None
        if llm_available and layer is not None and questions:

            def answer_runner(q: str) -> dict:
                r = layer.ask(q, hidden_tables=hidden)
                return {
                    "sql_used": r.sql_used,
                    "sources_touched": r.sources_touched,
                }

        report = verify_model(
            draft,
            schema_info=schema_info or None,
            use_llm=llm_available,
            query_runner=query_runner,
            answer_runner=answer_runner,
            questions=questions,
        )
        run.report["verification"] = report
        summary = report["summary"]
        detail = (
            f"{summary['warnings']} warnings "
            f"({summary['blocking']} blocking), {summary['advisory']} advisory notes"
        )
        # Blocking issues are surfaced in the report but don't hard-fail the run.
        run.finish(STAGE_VERIFICATION, detail)
    except Exception as exc:  # noqa: BLE001
        logger.warning("pipeline verification stage failed: %s", exc, exc_info=True)
        run.fail(STAGE_VERIFICATION, str(exc))

    run.complete()
    store.set_current(run)
    # Release the build's intermediate structures (proposal, schema samples,
    # analyze output) now that the model is persisted — keeps the resident set
    # low after a run on memory-bounded instances.
    gc.collect()
    return run


def _sample_questions(draft: dict, limit: int = 5) -> list[str]:
    """Derive a few representative questions from the generated templates — the
    natural-language phrases the model claims it can answer."""
    questions: list[str] = []
    seen: set[str] = set()
    for t in draft.get("templates", []) or []:
        kw = t.get("keywords") or []
        q = (kw[0] if kw else (t.get("name") or "")).strip()
        if q and q.lower() not in seen:
            seen.add(q.lower())
            questions.append(q)
        if len(questions) >= limit:
            break
    return questions
