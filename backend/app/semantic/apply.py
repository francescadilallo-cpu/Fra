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


def _apply_metrics(proposal: dict, sector_id: str) -> int:
    """Insert proposed metrics into the sector-scoped ``sl_metrics`` store."""
    applied = 0
    for m in proposal.get("metrics", []) or []:
        if float(m.get("confidence", 0)) < _MIN_CONFIDENCE:
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


def apply_proposal(
    proposal: dict, catalog: Any, sector_id: str = "manufacturing"
) -> dict[str, int]:
    """Persist the high-confidence parts of *proposal*. Returns applied counts."""
    if not proposal:
        return {"relations": 0, "entities": 0, "metrics": 0}
    counts = {
        "relations": _apply_relations(proposal, catalog) if catalog else 0,
        "entities": _apply_entity_descriptions(proposal, catalog) if catalog else 0,
        "metrics": _apply_metrics(proposal, sector_id),
    }
    logger.info("apply_proposal: %s", counts)
    return counts
