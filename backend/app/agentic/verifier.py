"""Stage 5 — reliability / consistency verification (SKELETON).

This is the hook where a round of agents will check the auto-built model and the
mapped data for reliability and consistency (orphan entities, metrics with no
backing table, relations pointing at missing tables, low-quality columns, …).

For this first iteration it runs a few cheap deterministic checks and returns a
report in the shape the real agentic pass will use. The heavy agentic logic
(LLM critique, golden-question replay, faithfulness scoring) is intentionally
left as a TODO.
"""

from __future__ import annotations

from typing import Any


def verify_model(draft: dict[str, Any]) -> dict[str, Any]:
    """Run lightweight consistency checks over a semantic draft.

    Returns ``{ok, checks, warnings, summary}``. ``checks`` is the list of
    checks performed; ``warnings`` are the issues found. This is deliberately a
    stub — see module docstring.
    """
    entities = draft.get("entities", []) or []
    metrics = draft.get("metrics", []) or []
    relations = draft.get("relations", []) or []

    entity_tables = {e.get("table") for e in entities if e.get("table")}
    warnings: list[dict[str, str]] = []

    # Check: relations referencing tables with no entity.
    for r in relations:
        for side in ("from_table", "to_table"):
            tbl = r.get(side)
            if tbl and tbl not in entity_tables:
                warnings.append(
                    {
                        "type": "relation_unknown_table",
                        "detail": f"Relation references '{tbl}' which has no entity.",
                    }
                )

    # Check: entities with no described columns.
    for e in entities:
        if not e.get("columns"):
            warnings.append(
                {
                    "type": "entity_no_columns",
                    "detail": f"Entity '{e.get('name')}' has no columns.",
                }
            )

    checks = [
        "relation_unknown_table",
        "entity_no_columns",
        # TODO: metric-backing-table, orphan-entity, column-quality, golden-question replay
    ]

    return {
        "ok": not warnings,
        "checks": checks,
        "warnings": warnings,
        "summary": {
            "entities": len(entities),
            "metrics": len(metrics),
            "relations": len(relations),
            "warnings": len(warnings),
        },
    }
