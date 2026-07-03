"""Stage 5 — reliability / consistency verification.

A round of checks over the auto-built model and the mapped data. Two layers:

1. Deterministic, schema-aware checks (no LLM): relations pointing at missing
   tables/columns, metrics whose formula references unknown table.column,
   duplicate entities, entities without columns/primary key, metrics without a
   formula. These are fast and always run.
2. An optional LLM critique that adds advisory notes; it degrades gracefully
   when no provider is configured.

Returns a structured report so the frontend can show what to fix. The heavier
agentic passes (golden-question replay, faithfulness scoring) remain a TODO.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Callable

logger = logging.getLogger(__name__)

# table.column references inside a metric formula, e.g. SUM(orders.total)
_REF_RE = re.compile(r"\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b")

# Severity that makes the report not-ok.
_BLOCKING = {"high", "medium"}

# Cap how many templates we actually replay, to keep the pass fast.
_MAX_TEMPLATES_TO_REPLAY = 25

# Faithfulness sampling: how many NL answers to score, and the minimum share
# that must be grounded in data (have SQL / touched sources) before we warn.
_MAX_FAITHFULNESS_QUESTIONS = 5
_MIN_GROUNDED_RATIO = 0.6


def _columns_by_table(schema_info: dict[str, dict] | None) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for table, info in (schema_info or {}).items():
        cols = {c.get("name") for c in (info.get("columns") or []) if c.get("name")}
        out[table] = cols
    return out


def _check_relations(
    relations: list[dict], entity_tables: set[str], cols: dict[str, set[str]]
) -> list[dict]:
    warnings: list[dict] = []
    for r in relations:
        ft, tt = r.get("from_table"), r.get("to_table")
        for side, tbl in (("from_table", ft), ("to_table", tt)):
            if tbl and tbl not in entity_tables:
                warnings.append(
                    {
                        "type": "relation_unknown_table",
                        "severity": "high",
                        "detail": f"Relation references '{tbl}' which has no entity.",
                    }
                )
        via = r.get("via_column") or ""
        if via and cols and ft in cols and via not in cols[ft]:
            warnings.append(
                {
                    "type": "relation_unknown_column",
                    "severity": "medium",
                    "detail": f"Relation join column '{ft}.{via}' does not exist.",
                }
            )
    return warnings


def _check_metrics(metrics: list[dict], cols: dict[str, set[str]]) -> list[dict]:
    warnings: list[dict] = []
    for m in metrics:
        name = m.get("name", "?")
        formula = m.get("formula") or ""
        if not formula:
            warnings.append(
                {
                    "type": "metric_no_formula",
                    "severity": "low",
                    "detail": f"Metric '{name}' has no formula.",
                }
            )
            continue
        if not cols:
            continue
        for tbl, col in _REF_RE.findall(formula):
            if tbl in cols and col not in cols[tbl]:
                warnings.append(
                    {
                        "type": "metric_unknown_reference",
                        "severity": "medium",
                        "detail": f"Metric '{name}' references '{tbl}.{col}' which does not exist.",
                    }
                )
    return warnings


def _check_entities(entities: list[dict]) -> list[dict]:
    warnings: list[dict] = []
    seen_tables: dict[str, str] = {}
    for e in entities:
        name = e.get("name", "?")
        table = e.get("table")
        if not e.get("columns"):
            warnings.append(
                {
                    "type": "entity_no_columns",
                    "severity": "low",
                    "detail": f"Entity '{name}' has no columns.",
                }
            )
        if table and table in seen_tables:
            warnings.append(
                {
                    "type": "duplicate_entity_table",
                    "severity": "medium",
                    "detail": f"Entities '{seen_tables[table]}' and '{name}' both map to table '{table}'.",
                }
            )
        elif table:
            seen_tables[table] = name
    return warnings


def _fill_tokens(sql: str) -> str:
    """Substitute the supported template tokens with safe default values,
    matching SemanticLayer._execute_template_query ({year}→2024, {limit}→10)."""
    return sql.replace("{year}", "2024").replace("{limit}", "10")


def _check_templates(
    templates: list[dict], query_runner: Callable[[str], Any]
) -> tuple[list[dict], int]:
    """Replay generated query templates against the data — a 'does it actually
    run?' reliability check on the mapped model. Returns (warnings, tested)."""
    warnings: list[dict] = []
    tested = 0
    for t in templates[:_MAX_TEMPLATES_TO_REPLAY]:
        sql = (t.get("sql_query") or "").strip()
        if not sql:
            continue
        tested += 1
        try:
            query_runner(_fill_tokens(sql))
        except Exception as exc:  # noqa: BLE001 — a failing query is the finding
            warnings.append(
                {
                    "type": "template_query_failed",
                    "severity": "medium",
                    "detail": f"Query '{t.get('name', '?')}' failed to run: {str(exc)[:160]}",
                }
            )
    return warnings, tested


_MAX_SAME_AS_CHECKS = 10


def _pk_of(table: str, cols: dict[str, set[str]]) -> str | None:
    """Primary-key candidate column of *table* (same rule as the KG scans)."""
    tl = table.lower()
    for c in cols.get(table, set()):
        if c.lower() in ("id", "pk", f"{tl}_id", f"{tl}id"):
            return c
    return None


def _check_same_as_coverage(
    relations: list[dict],
    cols: dict[str, set[str]],
    query_runner: Callable[[str], Any],
) -> list[dict]:
    """Reliability check on cross-source entity merges (SAME_AS bridges).

    Two tables declared the same entity should cover the same records; keys
    present in one but missing from the other are a data-consistency finding
    the user should know about. Advisory (info) — a partial export is often
    legitimate, but it changes which table you should aggregate on.
    """
    notes: list[dict] = []
    checked = 0
    for rel in relations:
        if rel.get("edge_type") != "SAME_AS" or checked >= _MAX_SAME_AS_CHECKS:
            continue
        ta, tb = rel.get("from_table"), rel.get("to_table")
        pk_a, pk_b = _pk_of(ta or "", cols), _pk_of(tb or "", cols)
        if not (ta and tb and pk_a and pk_b):
            continue
        checked += 1
        for x, px, y, py in ((ta, pk_a, tb, pk_b), (tb, pk_b, ta, pk_a)):
            try:
                rows = query_runner(
                    f'SELECT COUNT(*) AS n FROM (SELECT "{px}" FROM "{x}" '
                    f'EXCEPT SELECT "{py}" FROM "{y}")'
                )
                n = int((rows or [{}])[0].get("n") or 0)
            except Exception:  # noqa: BLE001 — advisory check, never blocks
                continue
            if n > 0:
                notes.append(
                    {
                        "type": "same_as_coverage_gap",
                        "severity": "info",
                        "detail": (
                            f"'{x}' and '{y}' describe the same entity, but "
                            f"{n} record(s) of '{x}' are missing from '{y}' — "
                            f"aggregate on the union (or on '{x}') for complete "
                            "numbers."
                        ),
                    }
                )
    return notes


def _check_faithfulness(
    questions: list[str], answer_runner: Callable[[str], dict]
) -> tuple[list[dict], float | None, int]:
    """Sample NL answers and score how many are *grounded* in data.

    An answer is grounded when it carries SQL or touched at least one source —
    i.e. it was computed from the data rather than free-form generated. Returns
    (warnings, grounded_ratio, sampled). A low ratio is the faithfulness finding.
    """
    sampled = 0
    grounded = 0
    seen: set[str] = set()
    for q in questions:
        q = (q or "").strip()
        if not q or q.lower() in seen:
            continue
        seen.add(q.lower())
        if sampled >= _MAX_FAITHFULNESS_QUESTIONS:
            break
        try:
            res = answer_runner(q) or {}
        except Exception:  # noqa: BLE001 — a failed answer just isn't grounded
            sampled += 1
            continue
        sampled += 1
        if res.get("sql_used") or (res.get("sources_touched") or []):
            grounded += 1

    if sampled == 0:
        return [], None, 0
    score = round(grounded / sampled, 2)
    warnings: list[dict] = []
    if score < _MIN_GROUNDED_RATIO:
        warnings.append(
            {
                "type": "low_faithfulness",
                "severity": "medium",
                "detail": (
                    f"Only {grounded}/{sampled} sampled answers were grounded in "
                    f"data (faithfulness {score}). Answers may not be backed by the model."
                ),
            }
        )
    return warnings, score, sampled


def _llm_critique(draft: dict) -> list[dict]:
    """Optional advisory critique from the LLM. Empty list if unavailable."""
    try:
        from ..semantic.layer import complete_json_llm  # noqa: PLC0415

        entities = [
            {"name": e.get("name"), "table": e.get("table")}
            for e in draft.get("entities", [])[:30]
        ]
        metrics = [
            {"name": m.get("name"), "formula": m.get("formula")}
            for m in draft.get("metrics", [])[:30]
        ]
        system = (
            "You are reviewing an auto-generated business data model for "
            "reliability and consistency. Respond with JSON only: "
            '{"notes":[{"detail":""}]}. List at most 5 concrete, high-value '
            "concerns (missing key metrics, dubious relations, naming issues). "
            "If the model looks sound, return an empty list."
        )
        user = f"Entities: {entities}\nMetrics: {metrics}\nRelations: {draft.get('relations', [])[:30]}"
        raw = complete_json_llm(system, user, max_tokens=600)
        if not raw:
            return []
        notes = []
        for n in raw.get("notes", []) or []:
            detail = (
                str((n or {}).get("detail", "")).strip() if isinstance(n, dict) else ""
            )
            if detail:
                notes.append({"type": "advisory", "severity": "info", "detail": detail})
        return notes[:5]
    except Exception as exc:  # noqa: BLE001 — advisory only
        logger.debug("LLM critique skipped: %s", exc)
        return []


def verify_model(
    draft: dict[str, Any],
    schema_info: dict[str, dict] | None = None,
    use_llm: bool = False,
    query_runner: Callable[[str], Any] | None = None,
    answer_runner: Callable[[str], dict] | None = None,
    questions: list[str] | None = None,
) -> dict[str, Any]:
    """Run consistency checks over a semantic draft.

    Returns ``{ok, checks, warnings, advisory, summary}``. ``ok`` is False when
    any high/medium-severity warning is present. *schema_info* (table → columns)
    enables the deeper column-level checks; *use_llm* adds advisory notes;
    *query_runner* (a read-only SQL executor) enables replaying the generated
    query templates; *answer_runner* + *questions* enable faithfulness scoring
    of sampled NL answers.
    """
    entities = draft.get("entities", []) or []
    metrics = draft.get("metrics", []) or []
    relations = draft.get("relations", []) or []
    templates = draft.get("templates", []) or []

    # Relations may reference entities by *name* (ontology/business KG nodes,
    # e.g. "SalesOrder") or by *table* (schema-built KG) — both are valid
    # endpoints, so the known-set carries both. Checking tables alone flagged
    # every ontology relation as "no entity" on a perfectly healthy model.
    entity_tables = {e.get("table") for e in entities if e.get("table")} | {
        e.get("name") for e in entities if e.get("name")
    }
    cols = _columns_by_table(schema_info)

    warnings: list[dict] = []
    warnings += _check_relations(relations, entity_tables, cols)
    warnings += _check_metrics(metrics, cols)
    warnings += _check_entities(entities)

    templates_tested = 0
    if query_runner is not None and templates:
        tpl_warnings, templates_tested = _check_templates(templates, query_runner)
        warnings += tpl_warnings

    faithfulness: float | None = None
    faithfulness_sampled = 0
    if answer_runner is not None and questions:
        f_warnings, faithfulness, faithfulness_sampled = _check_faithfulness(
            questions, answer_runner
        )
        warnings += f_warnings

    advisory = _llm_critique(draft) if use_llm else []
    if query_runner is not None:
        advisory += _check_same_as_coverage(relations, cols, query_runner)

    checks = [
        "relation_unknown_table",
        "relation_unknown_column",
        "metric_unknown_reference",
        "metric_no_formula",
        "entity_no_columns",
        "duplicate_entity_table",
        "template_query_failed",
        "same_as_coverage_gap",
        "low_faithfulness",
    ]

    blocking = [w for w in warnings if w.get("severity") in _BLOCKING]
    return {
        "ok": not blocking,
        "checks": checks,
        "warnings": warnings,
        "advisory": advisory,
        "summary": {
            "entities": len(entities),
            "metrics": len(metrics),
            "relations": len(relations),
            "templates_tested": templates_tested,
            "faithfulness_score": faithfulness,
            "faithfulness_sampled": faithfulness_sampled,
            "warnings": len(warnings),
            "blocking": len(blocking),
            "advisory": len(advisory),
        },
    }
