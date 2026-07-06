"""Auto-generate Query Templates from semantic layer metadata.

Called after every semantic-layer build. Inspects entities, metrics, and
relations to produce data-driven SQL templates that cover common analytics
patterns (total, average, by-segment, top-N). Templates are upserted into
the query_templates table — existing user-edited templates are never overwritten.
"""

from __future__ import annotations

import re
from typing import Any

# Heuristic column name sets (lowercase)
_DATE_HINTS = {
    "date",
    "data",
    "created_at",
    "order_date",
    "sale_date",
    "invoice_date",
    "timestamp",
    "dt",
    "data_ordine",
    "data_fattura",
    "data_vendita",
}
_SEGMENT_HINTS = {
    "segment",
    "segmento",
    "category",
    "categoria",
    "tipo",
    "type",
    "group",
    "gruppo",
    "classe",
    "class",
    "tier",
    "fascia",
    "industry",
    "industria",
    "sector",
    "settore",
    "channel",
    "canale",
}
_NAME_HINTS = {
    "name",
    "nome",
    "description",
    "denominazione",
    "ragione_sociale",
    "customer_name",
    "company_name",
    "product_name",
    "title",
    "label",
}

_FORMULA_RE = re.compile(
    r"(?:SUM|AVG|COUNT|MAX|MIN)\s*\(\s*(?:DISTINCT\s+)?(?:(\w+)\.)?(\w+)\s*\)",
    re.IGNORECASE,
)


def _find_date_col(columns: list[str]) -> str | None:
    for col in columns:
        if col.lower() in _DATE_HINTS:
            return col
    for col in columns:
        lc = col.lower()
        if "date" in lc or "data" in lc or "timestamp" in lc:
            return col
    return None


def _find_segment_cols(columns: list[str]) -> list[str]:
    result = []
    for col in columns:
        lc = col.lower()
        if lc in _SEGMENT_HINTS or any(h in lc for h in _SEGMENT_HINTS):
            result.append(col)
    return result[:3]


def _find_name_col(columns: list[str]) -> str | None:
    for col in columns:
        if col.lower() in _NAME_HINTS:
            return col
    return None


def _parse_formula(formula: str) -> tuple[str | None, str | None]:
    """Extract (table, column) from a SQL aggregate formula."""
    m = _FORMULA_RE.search(formula)
    if m:
        return m.group(1), m.group(2)
    return None, None


def _pk_col(table: str, columns: list[str]) -> str | None:
    """Primary-key candidate column (same rule as the KG scans)."""
    tl = table.lower()
    for c in columns:
        if c.lower() in ("id", "pk", f"{tl}_id", f"{tl}id"):
            return c
    return None


def _kws(*phrases: str) -> list[str]:
    """Keyword list with snake_case space-variants.

    Users ask "how many erp orders", not "how many erp_orders" — every phrase
    containing an underscore also matches with spaces.
    """
    out: list[str] = []
    for p in phrases:
        if not p:
            continue
        for v in (p, p.replace("_", " ")):
            if v not in out:
                out.append(v)
    return out


def generate_templates_from_draft(draft: dict[str, Any]) -> list[dict]:
    """Return auto-generated template dicts from a semantic draft.

    Each dict has: name, description, sql_query, keywords, sources, auto_generated=True.
    The caller is responsible for upsert into the DB.
    """
    entities: list[dict] = draft.get("entities", [])
    metrics: list[dict] = draft.get("metrics", [])
    relations: list[dict] = draft.get("relations", [])

    table_to_entity: dict[str, dict] = {e["table"]: e for e in entities}

    # relation graph: from_table → list of relation dicts
    rel_map: dict[str, list[dict]] = {}
    for r in relations:
        rel_map.setdefault(r["from_table"], []).append(r)

    templates: list[dict] = []

    # ── Metric-level templates ────────────────────────────────────────────────
    for metric in metrics:
        formula = metric.get("formula", "")
        label = (metric.get("label") or metric.get("name", "")).strip()
        mname = metric.get("name", "").strip()
        unit = metric.get("unit", "")
        if not label:
            label = mname

        m_table, m_col = _parse_formula(formula)
        if not m_col:
            continue

        # Resolve entity for this metric
        entity: dict | None = None
        if m_table:
            entity = table_to_entity.get(m_table) or {"table": m_table, "columns": []}
        if entity is None:
            # fuzzy fallback: first entity whose table name appears in metric name
            for e in entities:
                if e["table"].lower() in mname.lower():
                    entity = e
                    break
        if entity is None and entities:
            entity = entities[0]
        if entity is None:
            continue

        tbl = entity["table"]
        cols: list[str] = entity.get("columns", [])
        date_col = _find_date_col(cols)
        seg_cols = _find_segment_cols(cols)
        unit_str = f" ({unit})" if unit else ""

        def _year_where(dc: str | None) -> str:
            return f"\nWHERE YEAR({dc}) = {{year}}" if dc else ""

        # Template A: Total
        sql_total = (
            f"SELECT SUM({m_col}) AS {mname}{_year_where(date_col)}\nFROM {tbl}"
            if not date_col
            else f"SELECT SUM({m_col}) AS {mname}\nFROM {tbl}\nWHERE YEAR({date_col}) = {{year}}"
        )
        templates.append(
            {
                "name": f"Total {label}",
                "description": f"Total {label}{unit_str}, with optional year filter",
                "sql_query": sql_total,
                "keywords": _kws(
                    f"totale {label.lower()}",
                    f"total {mname.lower()}",
                    f"somma {label.lower()}",
                    f"sum {mname.lower()}",
                    label.lower(),
                    mname.lower(),
                ),
                "sources": [tbl],
                "auto_generated": True,
            }
        )

        # Template B: Average
        sql_avg = (
            f"SELECT AVG({m_col}) AS avg_{mname}\nFROM {tbl}"
            if not date_col
            else f"SELECT AVG({m_col}) AS avg_{mname}\nFROM {tbl}\nWHERE YEAR({date_col}) = {{year}}"
        )
        templates.append(
            {
                "name": f"Average {label}",
                "description": f"Average {label}{unit_str}",
                "sql_query": sql_avg,
                "keywords": _kws(
                    f"media {label.lower()}",
                    f"average {mname.lower()}",
                    f"medio {label.lower()}",
                    f"avg {mname.lower()}",
                    f"{label.lower()} medio",
                    f"{mname.lower()} average",
                ),
                "sources": [tbl],
                "auto_generated": True,
            }
        )

        # Template C: By segment (first segment col only)
        if seg_cols:
            seg = seg_cols[0]
            sql_seg = (
                f"SELECT {seg}, SUM({m_col}) AS {mname}\n"
                f"FROM {tbl}"
                + (f"\nWHERE YEAR({date_col}) = {{year}}" if date_col else "")
                + f"\nGROUP BY {seg}\nORDER BY {mname} DESC"
            )
            templates.append(
                {
                    "name": f"{label} by {seg}",
                    "description": f"{label} grouped by {seg}",
                    "sql_query": sql_seg,
                    "keywords": _kws(
                        f"per {seg.lower()}",
                        f"by {seg.lower()}",
                        f"{label.lower()} per {seg.lower()}",
                        f"{mname.lower()} by {seg.lower()}",
                        "per segmento",
                        "by segment",
                        "per categoria",
                        "by category",
                    ),
                    "sources": [tbl],
                    "auto_generated": True,
                }
            )

        # Template D: Top-N joined entity
        for rel in rel_map.get(tbl, [])[:1]:
            to_ent = table_to_entity.get(rel["to_table"])
            if not to_ent:
                continue
            via = rel.get("via_column", "")
            name_col = _find_name_col(to_ent.get("columns", []))
            if not (via and name_col):
                continue
            ent_label = to_ent.get("name", rel["to_table"])
            sql_top = (
                f"SELECT e.{name_col}, SUM(m.{m_col}) AS {mname}\n"
                f"FROM {tbl} m\n"
                f"JOIN {rel['to_table']} e ON m.{via} = e.id\n"
                f"GROUP BY e.{name_col}\n"
                f"ORDER BY {mname} DESC\n"
                f"LIMIT {{limit}}"
            )
            templates.append(
                {
                    "name": f"Top {ent_label} by {label}",
                    "description": f"{ent_label} ranked by {label}",
                    "sql_query": sql_top,
                    "keywords": _kws(
                        f"top {ent_label.lower()}",
                        f"migliori {ent_label.lower()}",
                        f"best {ent_label.lower()}",
                        f"classifica {ent_label.lower()}",
                        f"top {ent_label.lower()} per {label.lower()}",
                        "top clienti",
                        "migliori clienti",
                        "top customers",
                    ),
                    "sources": [tbl, rel["to_table"]],
                    "auto_generated": True,
                }
            )

    # ── Entity-level templates ────────────────────────────────────────────────
    for entity in entities:
        tbl = entity["table"]
        ename = entity.get("name", tbl)
        cols = entity.get("columns", [])
        seg_cols = _find_segment_cols(cols)
        date_col = _find_date_col(cols)

        # Count
        templates.append(
            {
                "name": f"How many {ename}",
                "description": f"Total record count in {tbl}",
                "sql_query": f"SELECT COUNT(*) AS total_{tbl}\nFROM {tbl}",
                "keywords": _kws(
                    f"quanti {ename.lower()}",
                    f"how many {ename.lower()}",
                    f"numero {ename.lower()}",
                    f"count {ename.lower()}",
                    f"totale {ename.lower()}",
                    f"numero di {ename.lower()}",
                ),
                "sources": [tbl],
                "auto_generated": True,
            }
        )

        # Group by each segment col
        for seg in seg_cols[:2]:
            templates.append(
                {
                    "name": f"{ename} by {seg}",
                    "description": f"Distribution of {ename} by {seg}",
                    "sql_query": (
                        f"SELECT {seg}, COUNT(*) AS count\n"
                        f"FROM {tbl}\n"
                        f"GROUP BY {seg}\n"
                        f"ORDER BY count DESC"
                    ),
                    "keywords": _kws(
                        f"{ename.lower()} per {seg.lower()}",
                        f"{ename.lower()} by {seg.lower()}",
                        f"distribuzione {ename.lower()}",
                        f"distribution {ename.lower()}",
                        f"per {seg.lower()}",
                    ),
                    "sources": [tbl],
                    "auto_generated": True,
                }
            )

        # New per year (if date col found)
        if date_col:
            templates.append(
                {
                    "name": f"New {ename} per year",
                    "description": f"New {ename} per year",
                    "sql_query": (
                        f"SELECT YEAR({date_col}) AS year, COUNT(*) AS new_count\n"
                        f"FROM {tbl}\n"
                        f"GROUP BY YEAR({date_col})\n"
                        f"ORDER BY year DESC"
                    ),
                    "keywords": _kws(
                        f"nuovi {ename.lower()}",
                        f"new {ename.lower()}",
                        f"{ename.lower()} per anno",
                        f"{ename.lower()} by year",
                        f"crescita {ename.lower()}",
                        f"acquisizione {ename.lower()}",
                    ),
                    "sources": [tbl],
                    "auto_generated": True,
                }
            )

    # ── Merged-entity templates (SAME_AS bridges) ─────────────────────────────
    # Two tables declared the same entity (cross-source merge) get a distinct-
    # union count, so "how many unique customers" spans BOTH sources instead of
    # silently counting one table.
    for r in relations:
        if r.get("edge_type") != "SAME_AS":
            continue
        ta, tb = r.get("from_table", ""), r.get("to_table", "")
        ea, eb = table_to_entity.get(ta), table_to_entity.get(tb)
        if not (ea and eb):
            continue
        pk_a = _pk_col(ta, ea.get("columns", []))
        pk_b = _pk_col(tb, eb.get("columns", []))
        if not (pk_a and pk_b):
            continue
        base_a, base_b = ta.split("_")[-1], tb.split("_")[-1]
        templates.append(
            {
                "name": f"Unique {ta} across sources",
                "description": (
                    f"Distinct records across {ta} and {tb} — the two tables "
                    "describe the same entity from different sources"
                ),
                "sql_query": (
                    f"SELECT COUNT(*) AS unique_records\n"
                    f'FROM (SELECT "{pk_a}" AS k FROM {ta}\n'
                    f'      UNION SELECT "{pk_b}" FROM {tb})'
                ),
                "keywords": _kws(
                    f"unique {ta}",
                    f"unique {tb}",
                    f"unique {base_a}",
                    f"unique {base_b}",
                    f"{base_a} across sources",
                    f"{base_b} across sources",
                    f"all {base_a} across sources",
                    "across sources",
                ),
                "sources": [ta, tb],
                "auto_generated": True,
            }
        )

    # Deduplicate by name (first wins)
    seen: set[str] = set()
    unique: list[dict] = []
    for t in templates:
        if t["name"] not in seen:
            seen.add(t["name"])
            unique.append(t)
    return unique
