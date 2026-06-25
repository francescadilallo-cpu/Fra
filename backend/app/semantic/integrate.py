"""Stage 4 — conversational / manual model integration.

Lets a user refine the auto-built model in plain language ("link orders to
customers via customer_id", "add a revenue metric = SUM(orders.total)",
"describe the Customer entity as our B2B buyers"). The instruction is turned
into a small, fixed vocabulary of *additive* operations and applied through the
same durable stores the manual editing endpoints use.

Only additive/descriptive ops are supported (add relation, describe entity, add
metric) — no deletes or renames — so conversational edits are low-risk and
fully reversible from the Data Model editor.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

_ALLOWED_OPS = {"add_relation", "set_entity_description", "add_metric"}


def _build_prompt(instruction: str, draft: dict) -> tuple[str, str]:
    entities = [
        {
            "name": e.get("name"),
            "table": e.get("table"),
            "columns": e.get("columns", [])[:30],
        }
        for e in draft.get("entities", [])[:30]
    ]
    metrics = [m.get("name") for m in draft.get("metrics", [])[:30]]
    system = (
        "You translate a user's plain-language request into edits to a business "
        "data model. Respond with JSON only. Use ONLY these operations:\n"
        '- {"op":"add_relation","from_table":"","to_table":"","via_column":""}\n'
        '- {"op":"set_entity_description","entity":"","description":""}\n'
        '- {"op":"add_metric","name":"","formula":"","description":"","unit":""}\n'
        "Reference only the tables/columns/entities provided. Formulas use real "
        "columns as table.column (e.g. SUM(orders.total)). Do not invent deletes "
        'or renames. Shape: {"ops":[...]}. Empty list if nothing applies.'
    )
    user = (
        f"Entities: {entities}\nMetrics: {metrics}\n"
        f"Relations: {draft.get('relations', [])[:30]}\n\n"
        f"Request: {instruction}"
    )
    return system, user


def _sanitize_ops(
    raw: dict, valid_tables: set[str], entity_names: set[str]
) -> list[dict]:
    ops: list[dict] = []
    for o in (raw or {}).get("ops", []) or []:
        if not isinstance(o, dict):
            continue
        op = str(o.get("op", "")).strip()
        if op not in _ALLOWED_OPS:
            continue
        if op == "add_relation":
            ft, tt = (
                str(o.get("from_table", "")).strip(),
                str(o.get("to_table", "")).strip(),
            )
            if not ft or not tt or ft == tt:
                continue
            if valid_tables and (ft not in valid_tables or tt not in valid_tables):
                continue
            ops.append(
                {
                    "op": op,
                    "from_table": ft,
                    "to_table": tt,
                    "via_column": str(o.get("via_column", "")).strip(),
                }
            )
        elif op == "set_entity_description":
            ent = str(o.get("entity", "")).strip()
            desc = str(o.get("description", "")).strip()
            if not ent or not desc:
                continue
            ops.append({"op": op, "entity": ent, "description": desc})
        elif op == "add_metric":
            name = str(o.get("name", "")).strip()
            formula = str(o.get("formula", "")).strip()
            if not name or not formula:
                continue
            ops.append(
                {
                    "op": op,
                    "name": name,
                    "formula": formula,
                    "description": str(o.get("description", "")).strip(),
                    "unit": str(o.get("unit", "")).strip(),
                }
            )
    return ops


def interpret_instruction(instruction: str, draft: dict) -> dict[str, Any]:
    """Turn an NL instruction into a sanitized op list. Returns {ops, llm_used}."""
    valid_tables = {e.get("table") for e in draft.get("entities", []) if e.get("table")}
    entity_names = {e.get("name") for e in draft.get("entities", []) if e.get("name")}
    try:
        from .layer import complete_json_llm  # noqa: PLC0415

        system, user = _build_prompt(instruction, draft)
        raw = complete_json_llm(system, user, max_tokens=800)
        if raw is None:
            return {"ops": [], "llm_used": False}
        return {"ops": _sanitize_ops(raw, valid_tables, entity_names), "llm_used": True}
    except Exception as exc:  # noqa: BLE001 — degrade gracefully
        logger.warning("integrate interpret failed: %s", exc, exc_info=True)
        return {"ops": [], "llm_used": False}


def apply_ops(
    ops: list[dict], catalog: Any, sector_id: str = "manufacturing"
) -> dict[str, Any]:
    """Apply sanitized ops to the durable stores. Returns a summary + added metrics."""
    from .apply import insert_sl_metric  # noqa: PLC0415

    # Resolve entity names → catalog entity name (accept either name or table).
    name_set: set[str] = set()
    table_to_name: dict[str, str] = {}
    if catalog is not None:
        try:
            for e in catalog.get_draft_entities():
                if e.get("name"):
                    name_set.add(e["name"])
                if e.get("table"):
                    table_to_name[e["table"]] = e["name"]
        except Exception:  # noqa: BLE001
            pass

    existing_rel: set[tuple] = set()
    if catalog is not None:
        try:
            existing_rel = {
                (r["from_table"], r["to_table"], r.get("edge_type", "FK"))
                for r in catalog.list_manual_relations()
            }
        except Exception:  # noqa: BLE001
            pass

    applied: list[str] = []
    added_metrics: list[dict] = []
    counts = {"relations": 0, "entities": 0, "metrics": 0}

    for op in ops:
        kind = op["op"]
        if kind == "add_relation" and catalog is not None:
            via = op.get("via_column", "")
            edge_type = f"FK_{via}" if via else "FK"
            key = (op["from_table"], op["to_table"], edge_type)
            if key in existing_rel:
                continue
            catalog.add_manual_relation(
                op["from_table"], op["to_table"], via_column=via, edge_type=edge_type
            )
            existing_rel.add(key)
            counts["relations"] += 1
            applied.append(f"linked {op['from_table']} → {op['to_table']}")
        elif kind == "set_entity_description" and catalog is not None:
            ent = op["entity"]
            resolved = ent if ent in name_set else table_to_name.get(ent)
            if resolved and catalog.save_entity_draft(
                resolved, user_description=op["description"]
            ):
                counts["entities"] += 1
                applied.append(f"described {resolved}")
        elif kind == "add_metric":
            if insert_sl_metric(
                op["name"],
                op["formula"],
                op.get("description", ""),
                op.get("unit", ""),
                sector_id,
            ):
                counts["metrics"] += 1
                added_metrics.append(op)
                applied.append(f"added metric {op['name']}")

    return {"counts": counts, "applied": applied, "added_metrics": added_metrics}
