"""Apply a Smart-Connect proposal to the durable model stores.

``semantic/analyzer.analyze`` returns a *proposal* (entities, metrics,
relations) but persists nothing. This module is the missing bridge: it writes
the high-confidence parts of a proposal into the same durable stores the manual
editing endpoints use, so a freshly-built Knowledge Graph + Semantic Layer
actually reflect the inferred (and document-biased) model.

Targets (all reuse existing persistence):
- relations  → ``MetadataCatalog.add_manual_relation``   (picked up by the draft/KG)
- metrics    → ``sl_metrics`` table                       (as ``POST /api/semantic/metrics``)
- entity doc → ``MetadataCatalog.save_entity_draft``      (entity description)

Idempotent: existing manual relations, metric names and non-empty entity
descriptions are not duplicated/overwritten, so re-running the pipeline is safe.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any

logger = logging.getLogger(__name__)

_MIN_CONFIDENCE = 0.5


def _apply_relations(proposal: dict, catalog: Any) -> int:
    try:
        existing = {
            (r["from_table"], r["to_table"], r.get("edge_type", "FK"))
            for r in catalog.list_manual_relations()
        }
    except Exception:  # noqa: BLE001
        existing = set()

    applied = 0
    for r in proposal.get("relations", []) or []:
        if float(r.get("confidence", 0)) < _MIN_CONFIDENCE:
            continue
        ft, tt = r.get("from_table", ""), r.get("to_table", "")
        via = r.get("via_column", "") or ""
        if not ft or not tt or ft == tt:
            continue
        edge_type = f"FK_{via}" if via else "FK"
        if (ft, tt, edge_type) in existing:
            continue
        try:
            catalog.add_manual_relation(ft, tt, via_column=via, edge_type=edge_type)
            existing.add((ft, tt, edge_type))
            applied += 1
        except Exception:  # noqa: BLE001
            logger.debug("relation apply skipped: %s→%s", ft, tt)
    return applied


def _apply_entity_descriptions(proposal: dict, catalog: Any) -> int:
    """Set a description on each catalog entity, matched by source table."""
    try:
        table_to_name = {
            e["table"]: e["name"]
            for e in catalog.get_draft_entities()
            if e.get("table")
        }
        existing_desc = {
            e["name"]: (e.get("user_description") or "").strip()
            for e in catalog.get_draft_entities()
        }
    except Exception:  # noqa: BLE001
        return 0

    applied = 0
    for e in proposal.get("entities", []) or []:
        desc = (e.get("description") or "").strip()
        ent_name = table_to_name.get(e.get("table", ""))
        if not desc or not ent_name:
            continue
        if existing_desc.get(ent_name):  # don't overwrite a user-set description
            continue
        try:
            if catalog.save_entity_draft(ent_name, user_description=desc):
                applied += 1
        except Exception:  # noqa: BLE001
            logger.debug("entity description apply skipped: %s", ent_name)
    return applied


def insert_sl_metric(
    name: str,
    formula: str,
    description: str = "",
    unit: str = "",
    sector_id: str = "manufacturing",
) -> bool:
    """Insert one metric into the sector-scoped ``sl_metrics`` store.

    Idempotent on (sector_id, name): returns False if name/formula are empty or
    the metric already exists. Shared by the build stage and conversational
    integration so both write metrics the same way.
    """
    name = (name or "").strip()
    formula = (formula or "").strip()
    if not name or not formula:
        return False
    from ..database import get_connection

    conn = get_connection()
    try:
        exists = conn.execute(
            "SELECT 1 FROM sl_metrics WHERE sector_id=? AND lower(name)=lower(?)",
            (sector_id, name),
        ).fetchone()
        if exists:
            return False
        conn.execute(
            """INSERT INTO sl_metrics
               (id, sector_id, name, description, type, entity, field, numerator,
                denominator, expression, filters_json, time_dimension, grains_json,
                format, status, owner, tags_json, is_builtin)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)""",
            (
                f"m-{uuid.uuid4().hex[:12]}",
                sector_id,
                name,
                (description or "").strip(),
                "derived",
                "",
                "",
                "",
                "",
                formula,
                json.dumps([]),
                "",
                json.dumps(["month", "quarter", "year"]),
                "currency" if (unit or "").strip() else "number",
                "draft",
                "auto",
                json.dumps(["auto"]),
            ),
        )
        conn.commit()
        return True
    finally:
        conn.close()


_REF_RE = re.compile(r"\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b")


def _formula_refs_ok(formula: str, cols_by_table: dict[str, set[str]]) -> bool:
    """True if every ``table.column`` reference in *formula* exists in the schema.

    Only validates references whose table is known; unknown tables are left to
    the LLM/SQL guardrails. Prevents applying metrics that reference columns
    that don't exist (which would fail at query time)."""
    for tbl, col in _REF_RE.findall(formula or ""):
        if tbl in cols_by_table and col not in cols_by_table[tbl]:
            return False
    return True


def _apply_metrics(
    proposal: dict, sector_id: str, cols_by_table: dict[str, set[str]] | None = None
) -> int:
    """Insert proposed metrics into the sector-scoped ``sl_metrics`` store,
    skipping any whose formula references a column that doesn't exist."""
    applied = 0
    for m in proposal.get("metrics", []) or []:
        if float(m.get("confidence", 0)) < _MIN_CONFIDENCE:
            continue
        if cols_by_table and not _formula_refs_ok(m.get("formula", ""), cols_by_table):
            logger.debug("metric skipped (unknown column ref): %s", m.get("name"))
            continue
        if insert_sl_metric(
            m.get("name", ""),
            m.get("formula", ""),
            m.get("description", ""),
            m.get("unit", ""),
            sector_id,
        ):
            applied += 1
    return applied


def merge_proposal_metrics_into_draft(
    draft_metrics: list[dict], extra_metrics: list[dict]
) -> list[dict]:
    """Merge extra metrics (proposal/conversational) into draft metrics by name.

    Lets template generation cover freshly-added metrics that live in
    ``sl_metrics`` rather than the catalog's draft-metric store.
    """
    seen = {(m.get("name") or "").lower() for m in draft_metrics}
    merged = list(draft_metrics)
    for m in extra_metrics or []:
        name = (m.get("name") or "").strip()
        if name and name.lower() not in seen:
            merged.append(
                {
                    "name": name,
                    "label": name,
                    "description": m.get("description", ""),
                    "formula": m.get("formula", ""),
                    "unit": m.get("unit", ""),
                }
            )
            seen.add(name.lower())
    return merged


def _proposal_entity_aliases(proposal: dict) -> dict[str, list[str]]:
    """Collect proposed entity synonyms keyed by source table, for the KG to
    attach as aliases (so business terms link to the table node)."""
    aliases: dict[str, list[str]] = {}
    for e in proposal.get("entities", []) or []:
        table = str(e.get("table", "")).strip()
        syns = [str(s).strip() for s in (e.get("synonyms") or []) if str(s).strip()]
        if table and syns:
            aliases.setdefault(table, []).extend(syns)
    return aliases


def apply_proposal(
    proposal: dict,
    catalog: Any,
    sector_id: str = "manufacturing",
    schema_info: dict | None = None,
) -> dict[str, Any]:
    """Persist the high-confidence parts of *proposal*.

    Returns applied counts plus ``entity_aliases`` (proposed synonyms by table)
    for the caller to attach to the KG after the rebuild. *schema_info* enables
    skipping metrics whose formula references a non-existent column.
    """
    if not proposal:
        return {"relations": 0, "entities": 0, "metrics": 0, "entity_aliases": {}}
    cols_by_table = (
        {
            t: {c.get("name") for c in (info.get("columns") or []) if c.get("name")}
            for t, info in schema_info.items()
        }
        if schema_info
        else None
    )
    counts = {
        "relations": _apply_relations(proposal, catalog) if catalog else 0,
        "entities": _apply_entity_descriptions(proposal, catalog) if catalog else 0,
        "metrics": _apply_metrics(proposal, sector_id, cols_by_table),
        "entity_aliases": _proposal_entity_aliases(proposal),
    }
    logger.info(
        "apply_proposal: relations=%s entities=%s metrics=%s",
        counts["relations"],
        counts["entities"],
        counts["metrics"],
    )
    return counts
