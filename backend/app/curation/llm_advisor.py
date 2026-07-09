"""LLM curation advisor — judgement for tables the deterministic tiers left
"uncertain", plus cross-source merge proposals.

Strictly advisory and bounded:

- Only *uncertain* tables reach the LLM — never the whole schema, and never
  row data (column names and counts only).
- keep/exclude verdicts are applied as reversible curation decisions tagged
  ``llm`` (a user pin always beats them; the report shows the rationale).
- Every verdict and merge carries a self-reported confidence; anything below
  ``FRA_CURATION_LLM_MIN_CONFIDENCE`` (default 0.7) is skipped — the table
  stays "uncertain" for a human to decide.
- Merge proposals NEVER execute: each one is submitted as a MERGE_ENTITIES
  command to the Executive Agentic Layer, landing in the same
  PENDING_HUMAN_APPROVAL queue as any other write action. Pairs a human has
  already rejected (the store's deny-list) are never re-proposed.
- No provider key configured → the advisor reports itself unavailable; the
  deterministic tiers keep working.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

_MAX_UNCERTAIN = 40  # prompt guardrail: one advisory call stays bounded
_MAX_CONTEXT_DOC_CHARS = 2000
_DEFAULT_MIN_CONFIDENCE = 0.7

_SYSTEM_PROMPT = """You curate the data model of a business-intelligence workspace.
You receive tables whose business relevance is uncertain, the business entities
already in the model, and optional workspace context. Decide for each uncertain
table whether it is a business entity end users would query (keep) or technical
noise / plumbing (exclude). Also propose merges when an uncertain table clearly
represents the same real-world entity as an existing one (same business figure,
different source or language — e.g. "pazienti" vs Customer for a clinic).

Reply with ONLY a JSON object:
{
  "decisions": [
    {"table": "<name>", "decision": "keep"|"exclude",
     "confidence": <0.0-1.0>, "reason": "<short why>"}
  ],
  "merges": [
    {"table": "<uncertain or kept table>", "with_entity": "<existing entity name>",
     "concept": "<business concept>", "confidence": <0.0-1.0>,
     "reason": "<short why>"}
  ]
}
"confidence" is how sure you are of that specific verdict; low-confidence
verdicts are discarded and left for a human, so be honest rather than bold.
Be conservative: when unsure, keep. Never invent table or entity names."""

# JSON Schema for structured outputs (Anthropic ``output_config.format``):
# guarantees parseable output on providers that support it; others fall back
# to the prompt-driven contract above.
_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "decisions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "table": {"type": "string"},
                    "decision": {"type": "string", "enum": ["keep", "exclude"]},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "reason": {"type": "string"},
                },
                "required": ["table", "decision", "confidence", "reason"],
                "additionalProperties": False,
            },
        },
        "merges": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "table": {"type": "string"},
                    "with_entity": {"type": "string"},
                    "concept": {"type": "string"},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "reason": {"type": "string"},
                },
                "required": ["table", "with_entity", "confidence", "reason"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["decisions", "merges"],
    "additionalProperties": False,
}


def _min_confidence() -> float:
    raw = os.getenv("FRA_CURATION_LLM_MIN_CONFIDENCE", "").strip()
    try:
        value = float(raw) if raw else _DEFAULT_MIN_CONFIDENCE
    except ValueError:
        logger.warning(
            "FRA_CURATION_LLM_MIN_CONFIDENCE=%r is not a number — using %s",
            raw,
            _DEFAULT_MIN_CONFIDENCE,
        )
        value = _DEFAULT_MIN_CONFIDENCE
    return min(max(value, 0.0), 1.0)


def _confidence_of(item: dict) -> float:
    """Self-reported confidence, clamped to [0, 1]. A missing/broken value
    counts as fully confident so providers that ignore the field keep the
    pre-threshold behaviour instead of having every verdict discarded."""
    try:
        return min(max(float(item.get("confidence", 1.0)), 0.0), 1.0)
    except (TypeError, ValueError):
        return 1.0


def llm_available() -> bool:
    from app.semantic.layer import _llm_intent_provider  # noqa: PLC0415

    return _llm_intent_provider() is not None


def _complete_json(
    system_blocks: list[dict], user_content: str, schema: dict | None = None
) -> str:
    """Provider dispatch. *system_blocks* are Anthropic-style text blocks so
    stable blocks can carry ``cache_control``; for Groq they are flattened
    into one system string (OpenAI-compatible API, no block-level caching)."""
    from app.semantic.layer import (  # noqa: PLC0415
        _complete_json_via_anthropic,
        _complete_json_via_groq,
        _llm_intent_provider,
    )

    provider = _llm_intent_provider()
    if provider == "groq":
        flat = "\n\n".join(str(b.get("text", "")) for b in system_blocks)
        return _complete_json_via_groq(flat, user_content, max_tokens=1500)
    if provider == "anthropic":
        return _complete_json_via_anthropic(
            system_blocks, user_content, max_tokens=1500, schema=schema
        )
    raise RuntimeError("No LLM provider configured (GROQ_API_KEY / ANTHROPIC_API_KEY)")


def _build_system_blocks(
    kept_entities: list[dict], context_docs: list[str]
) -> list[dict]:
    """Instructions + the *stable* half of the prompt (existing entities,
    workspace context). These change rarely between advisory runs, so the
    last block is marked for Anthropic prompt caching; the volatile uncertain
    tables travel in the user turn instead."""
    stable: dict[str, Any] = {
        "existing_entities": [
            {
                "name": e.get("name"),
                "display_name": e.get("display_name"),
                "concept": e.get("canonical"),
                "columns": (e.get("columns") or [])[:20],
            }
            for e in kept_entities[:60]
        ],
    }
    if context_docs:
        stable["workspace_context"] = [
            doc[:_MAX_CONTEXT_DOC_CHARS] for doc in context_docs[:3]
        ]
    return [
        {"type": "text", "text": _SYSTEM_PROMPT},
        {
            "type": "text",
            "text": "Model context:\n"
            + json.dumps(stable, ensure_ascii=False, default=str),
            "cache_control": {"type": "ephemeral"},
        },
    ]


def advise(
    schema: dict[str, dict],
    entities: list[dict],
    context_docs: list[str],
    store,
    submit_merge,
) -> dict[str, Any]:
    """Run one advisory pass.

    ``store`` is the CurationStore; ``submit_merge(table, entity_name) -> str``
    submits a merge to the approval queue and returns a status string.
    Returns a summary for the API response.
    """
    decisions = store.all_decisions()
    uncertain_tables = [
        t
        for t, d in decisions.items()
        if d.get("status") == "uncertain" and t in schema
    ]
    if not uncertain_tables:
        return {
            "applied": [],
            "merge_proposals": [],
            "note": "No uncertain tables to advise on",
        }

    uncertain_payload = [
        {
            "table": t,
            "columns": [c.get("name", "") for c in (schema[t].get("columns") or [])][
                :25
            ],
            "row_count": schema[t].get("row_count", 0),
        }
        for t in uncertain_tables[:_MAX_UNCERTAIN]
    ]

    raw = _complete_json(
        _build_system_blocks(entities, context_docs),
        json.dumps(
            {"uncertain_tables": uncertain_payload}, ensure_ascii=False, default=str
        ),
        schema=_RESPONSE_SCHEMA,
    )
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"LLM returned invalid JSON: {exc}") from exc

    known_tables = set(uncertain_tables)
    entity_names = {str(e.get("name", "")) for e in entities}
    entity_table_by_name = {
        str(e.get("name", "")): str(e.get("table", "") or e.get("name", ""))
        for e in entities
    }
    threshold = _min_confidence()

    applied: list[dict] = []
    skipped: list[dict] = []
    for d in parsed.get("decisions") or []:
        table = str(d.get("table", ""))
        verdict = str(d.get("decision", "")).strip().lower()
        # Hallucination guard: only tables we actually asked about, only
        # known verdicts.
        if table not in known_tables or verdict not in ("keep", "exclude"):
            continue
        confidence = _confidence_of(d)
        if confidence < threshold:
            # Below threshold → the table stays "uncertain" for a human.
            skipped.append(
                {
                    "table": table,
                    "decision": verdict,
                    "confidence": confidence,
                    "reason": str(d.get("reason", "")).strip()[:200],
                }
            )
            continue
        status = "kept" if verdict == "keep" else "excluded"
        reason = f"llm:{str(d.get('reason', '')).strip()[:200]}"
        record = store.set_decision(table, status, reason, decided_by="llm")
        applied.append({"table": table, "confidence": confidence, **record})

    proposals: list[dict] = []
    for m in parsed.get("merges") or []:
        table = str(m.get("table", ""))
        target = str(m.get("with_entity", ""))
        if not table or target not in entity_names:
            continue
        confidence = _confidence_of(m)
        if confidence < threshold:
            skipped.append(
                {
                    "table": table,
                    "merge_with": target,
                    "confidence": confidence,
                    "reason": str(m.get("reason", "")).strip()[:200],
                }
            )
            continue
        # Deny-list: a human already rejected this pair — never re-propose.
        target_table = entity_table_by_name.get(target, target)
        if store.is_merge_denied(table, target_table) or store.is_merge_denied(
            table, target
        ):
            proposals.append(
                {
                    "table": table,
                    "with_entity": target,
                    "concept": m.get("concept"),
                    "reason": str(m.get("reason", ""))[:200],
                    "queued": "denied:pair previously rejected by a human",
                }
            )
            continue
        outcome = submit_merge(table, target)
        proposals.append(
            {
                "table": table,
                "with_entity": target,
                "concept": m.get("concept"),
                "confidence": confidence,
                "reason": str(m.get("reason", ""))[:200],
                "queued": outcome,
            }
        )

    result: dict[str, Any] = {"applied": applied, "merge_proposals": proposals}
    if skipped:
        result["skipped_low_confidence"] = skipped
    return result
