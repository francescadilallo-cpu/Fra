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
) -> dict[str, Any]:
    """Run consistency checks over a semantic draft.

    Returns ``{ok, checks, warnings, advisory, summary}``. ``ok`` is False when
    any high/medium-severity warning is present. *schema_info* (table → columns)
    enables the deeper column-level checks; *use_llm* adds advisory notes;
    *query_runner* (a read-only SQL executor) enables replaying the generated
    query templates against the data.
    """
    entities = draft.get("entities", []) or []
    metrics = draft.get("metrics", []) or []
    relations = draft.get("relations", []) or []
    templates = draft.get("templates", []) or []

    entity_tables = {e.get("table") for e in entities if e.get("table")}
    cols = _columns_by_table(schema_info)

    warnings: list[dict] = []
    warnings += _check_relations(relations, entity_tables, cols)
    warnings += _check_metrics(metrics, cols)
    warnings += _check_entities(entities)

    templates_tested = 0
    if query_runner is not None and templates:
        tpl_warnings, templates_tested = _check_templates(templates, query_runner)
        warnings += tpl_warnings

    advisory = _llm_critique(draft) if use_llm else []

    checks = [
        "relation_unknown_table",
        "relation_unknown_column",
        "metric_unknown_reference",
        "metric_no_formula",
        "entity_no_columns",
        "duplicate_entity_table",
        "template_query_failed",
        # TODO: faithfulness scoring on NL answers
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
            "warnings": len(warnings),
            "blocking": len(blocking),
            "advisory": len(advisory),
        },
    }
