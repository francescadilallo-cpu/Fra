"""LLM curation advisor — judgement for tables the deterministic tiers left
"uncertain", plus cross-source merge proposals.

Strictly advisory and bounded:

- Only *uncertain* tables reach the LLM — never the whole schema, and never
  row data (column names and counts only).
- keep/exclude verdicts are applied as reversible curation decisions tagged
  ``llm`` (a user pin always beats them; the report shows the rationale).
- Merge proposals NEVER execute: each one is submitted as a MERGE_ENTITIES
  command to the Executive Agentic Layer, landing in the same
  PENDING_HUMAN_APPROVAL queue as any other write action.
- No provider key configured → the advisor reports itself unavailable; the
  deterministic tiers keep working.
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

_MAX_UNCERTAIN = 40  # prompt guardrail: one advisory call stays bounded
_MAX_CONTEXT_DOC_CHARS = 2000

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
    {"table": "<name>", "decision": "keep"|"exclude", "reason": "<short why>"}
  ],
  "merges": [
    {"table": "<uncertain or kept table>", "with_entity": "<existing entity name>",
     "concept": "<business concept>", "reason": "<short why>"}
  ]
}
Be conservative: when unsure, keep. Never invent table or entity names."""


def llm_available() -> bool:
    from app.semantic.layer import _llm_intent_provider  # noqa: PLC0415

    return _llm_intent_provider() is not None


def _complete_json(system_prompt: str, user_content: str) -> str:
    from app.semantic.layer import (  # noqa: PLC0415
        _complete_json_via_anthropic,
        _complete_json_via_groq,
        _llm_intent_provider,
    )

    provider = _llm_intent_provider()
    if provider == "groq":
        return _complete_json_via_groq(system_prompt, user_content, max_tokens=1500)
    if provider == "anthropic":
        return _complete_json_via_anthropic(
            system_prompt, user_content, max_tokens=1500
        )
    raise RuntimeError("No LLM provider configured (GROQ_API_KEY / ANTHROPIC_API_KEY)")


def _build_prompt_payload(
    uncertain: list[dict],
    kept_entities: list[dict],
    context_docs: list[str],
) -> str:
    payload: dict[str, Any] = {
        "uncertain_tables": uncertain[:_MAX_UNCERTAIN],
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
        payload["workspace_context"] = [
            doc[:_MAX_CONTEXT_DOC_CHARS] for doc in context_docs[:3]
        ]
    return json.dumps(payload, ensure_ascii=False, default=str)


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
        _SYSTEM_PROMPT,
        _build_prompt_payload(uncertain_payload, entities, context_docs),
    )
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"LLM returned invalid JSON: {exc}") from exc

    known_tables = set(uncertain_tables)
    entity_names = {str(e.get("name", "")) for e in entities}

    applied: list[dict] = []
    for d in parsed.get("decisions") or []:
        table = str(d.get("table", ""))
        verdict = str(d.get("decision", "")).strip().lower()
        # Hallucination guard: only tables we actually asked about, only
        # known verdicts.
        if table not in known_tables or verdict not in ("keep", "exclude"):
            continue
        status = "kept" if verdict == "keep" else "excluded"
        reason = f"llm:{str(d.get('reason', '')).strip()[:200]}"
        record = store.set_decision(table, status, reason, decided_by="llm")
        applied.append({"table": table, **record})

    proposals: list[dict] = []
    for m in parsed.get("merges") or []:
        table = str(m.get("table", ""))
        target = str(m.get("with_entity", ""))
        if not table or target not in entity_names:
            continue
        outcome = submit_merge(table, target)
        proposals.append(
            {
                "table": table,
                "with_entity": target,
                "concept": m.get("concept"),
                "reason": str(m.get("reason", ""))[:200],
                "queued": outcome,
            }
        )

    return {"applied": applied, "merge_proposals": proposals}
