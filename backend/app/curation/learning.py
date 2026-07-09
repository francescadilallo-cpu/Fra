"""Curation learning loop — approved human decisions become workspace skills.

When a manager approves a MERGE_ENTITIES or SET_ENTITY_CONCEPT action, the
name of the newly-associated entity is folded back into the workspace skill
pack as a concept alias. From then on the matching is deterministic: the next
source that ships a "pazienti" table resolves to Customer instantly, with no
LLM call and no second approval.

Advisory by design: failures are logged and swallowed — learning must never
break the action that triggered it. Note: the workspace pack is rewritten via
YAML round-trip, so hand-written comments in it are not preserved.
"""

from __future__ import annotations

import logging

import yaml

from ..semantic.canonical import canonical_concept, extend_aliases, table_base_name
from .engine import workspace_pack_path

logger = logging.getLogger(__name__)

_MAX_ALIAS_LEN = 60


def _append_workspace_aliases(concept: str, aliases: list[str]) -> int:
    """Persist *aliases* under *concept* in the workspace pack and register
    them with the live canonical dictionary. Returns how many were added."""
    aliases = [
        a.strip().lower() for a in aliases if a and 1 < len(a.strip()) <= _MAX_ALIAS_LEN
    ]
    if not aliases:
        return 0

    path = workspace_pack_path()
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if not isinstance(raw, dict):
            raw = {}
    except FileNotFoundError:
        raw = {}
    raw.setdefault("pack", "workspace")
    section = raw.get("aliases")
    if not isinstance(section, dict):
        section = {}
    existing = [str(a).lower() for a in (section.get(concept) or [])]
    new = [a for a in aliases if a not in existing]
    if not new:
        # Still make sure the live dictionary knows them (fresh process).
        return extend_aliases(concept, existing)
    section[concept] = existing + new
    raw["aliases"] = section
    path.write_text(
        yaml.safe_dump(raw, allow_unicode=True, sort_keys=False), encoding="utf-8"
    )
    added = extend_aliases(concept, new)
    logger.info("curation learning: %s ← %s", concept, ", ".join(new))
    return added


def record_merge(entity_a: dict, entity_b: dict) -> int:
    """Learn from an approved merge: if one side resolves to a business
    concept, the other side's base name becomes an alias of that concept."""
    try:
        table_a = str(entity_a.get("table", ""))
        table_b = str(entity_b.get("table", ""))
        concept_a = entity_a.get("canonical") or canonical_concept(table_a)
        concept_b = entity_b.get("canonical") or canonical_concept(table_b)
        if concept_a and not concept_b:
            return _append_workspace_aliases(concept_a, [table_base_name(table_b)])
        if concept_b and not concept_a:
            return _append_workspace_aliases(concept_b, [table_base_name(table_a)])
        return 0
    except Exception as exc:  # noqa: BLE001 — learning is best-effort
        logger.warning("curation learning (merge) skipped: %s", exc)
        return 0


def record_concept(entity: dict, concept: str) -> int:
    """Learn from an approved concept assignment: the entity's base name
    becomes an alias of the assigned concept."""
    try:
        table = str(entity.get("table", ""))
        base = table_base_name(table)
        if canonical_concept(table) == concept:
            return 0  # dictionary already resolves it — nothing to learn
        return _append_workspace_aliases(concept, [base])
    except Exception as exc:  # noqa: BLE001 — learning is best-effort
        logger.warning("curation learning (concept) skipped: %s", exc)
        return 0
