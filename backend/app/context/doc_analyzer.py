"""Stage 1 — document context analysis.

Reads the documents the user uploaded as business context and extracts a small,
structured *prior*: glossary terms, candidate business entities and candidate
metrics, plus a domain hint. These priors are:

1. Persisted into the context store (glossary/entities/metrics) so they show up
   in the Context view and feed the NL prompt, and
2. returned to the build stage, where they bias the source-driven model
   proposal (``semantic/analyzer.analyze``) toward the user's own business
   vocabulary instead of raw column names.

The LLM call degrades gracefully: with no provider configured the function
still returns (empty priors) and records how many documents it saw, so the
pipeline keeps running.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

_MAX_DOCS = 12  # cap how many documents we feed the model
_MAX_CHARS_PER_DOC = 4000  # truncate each document
_MAX_TOTAL_CHARS = 16000  # hard cap on the whole prompt body


def _build_prompt(docs: list[Any]) -> tuple[str, str]:
    system = (
        "You are a data analyst reading a company's business documents to build "
        "a glossary and a draft data model. Respond with JSON only, no prose.\n\n"
        "Extract, using the documents' own wording:\n"
        "1. glossary — business terms with a one-sentence definition.\n"
        "2. entities — the key business objects mentioned (e.g. Customer, "
        "Order, Invoice): a short name, a one-sentence description, and any "
        "synonyms used in the text.\n"
        "3. metrics — business KPIs mentioned (e.g. revenue, churn rate): a "
        "name, a one-sentence description, and a unit if stated.\n"
        "4. domain — one or two words for the business domain (e.g. "
        "'manufacturing', 'retail').\n\n"
        "Only include items genuinely supported by the text. Use EXACTLY this "
        "JSON shape:\n"
        '{"glossary":[{"term":"","definition":""}],'
        '"entities":[{"name":"","description":"","synonyms":[]}],'
        '"metrics":[{"name":"","description":"","unit":""}],'
        '"domain":""}'
    )

    parts: list[str] = []
    total = 0
    for d in docs[:_MAX_DOCS]:
        body = (getattr(d, "content", "") or "")[:_MAX_CHARS_PER_DOC]
        chunk = f"--- {getattr(d, 'filename', 'document')} ---\n{body}"
        if total + len(chunk) > _MAX_TOTAL_CHARS:
            break
        parts.append(chunk)
        total += len(chunk)
    user = "Documents:\n\n" + "\n\n".join(parts)
    return system, user


def _clean_list(raw: Any) -> list[dict]:
    return [x for x in (raw or []) if isinstance(x, dict)]


def _sanitize(raw: dict) -> dict[str, Any]:
    glossary = []
    for g in _clean_list(raw.get("glossary")):
        term = str(g.get("term", "")).strip()
        definition = str(g.get("definition", "")).strip()
        if term and definition:
            glossary.append({"term": term, "definition": definition})

    entities = []
    for e in _clean_list(raw.get("entities")):
        name = str(e.get("name", "")).strip()
        if not name:
            continue
        syns = [str(s).strip() for s in (e.get("synonyms") or []) if str(s).strip()]
        entities.append(
            {
                "name": name,
                "description": str(e.get("description", "")).strip(),
                "synonyms": syns[:20],
            }
        )

    metrics = []
    for m in _clean_list(raw.get("metrics")):
        name = str(m.get("name", "")).strip()
        if not name:
            continue
        metrics.append(
            {
                "name": name,
                "description": str(m.get("description", "")).strip(),
                "unit": str(m.get("unit", "")).strip(),
            }
        )

    return {
        "glossary": glossary[:50],
        "entities": entities[:50],
        "metrics": metrics[:50],
        "domain": str(raw.get("domain", "")).strip()[:64],
    }


def _persist(store: Any, priors: dict, exclude_seeded: bool) -> None:
    """Write the extracted priors into the context store, de-duplicating by name.

    Glossary uses INSERT OR REPLACE (idempotent); entities/metrics are plain
    inserts, so we skip names that already exist to avoid duplicates on re-run.
    """
    try:
        existing_entities = {
            e.name.lower() for e in store.list_entities(exclude_seeded=exclude_seeded)
        }
        existing_metrics = {
            m.name.lower() for m in store.list_metrics(exclude_seeded=exclude_seeded)
        }
    except Exception:  # noqa: BLE001 — store read should not break the pipeline
        existing_entities, existing_metrics = set(), set()

    for g in priors["glossary"]:
        try:
            store.add_glossary_term(g["term"], g["definition"])
        except Exception:  # noqa: BLE001
            logger.debug("glossary persist skipped: %s", g.get("term"))

    for e in priors["entities"]:
        if e["name"].lower() in existing_entities:
            continue
        try:
            store.add_entity(
                e["name"], e["name"], e["synonyms"], e["description"], "document"
            )
        except Exception:  # noqa: BLE001
            logger.debug("entity persist skipped: %s", e.get("name"))

    for m in priors["metrics"]:
        if m["name"].lower() in existing_metrics:
            continue
        try:
            store.add_metric(
                m["name"], m["name"], [], m["description"], m["unit"], False
            )
        except Exception:  # noqa: BLE001
            logger.debug("metric persist skipped: %s", m.get("name"))


def analyze_documents(store: Any, mode: str = "demo") -> dict[str, Any]:
    """Analyse uploaded context documents and return structured priors.

    Returns ``{glossary, entities, metrics, domain, doc_count, llm_used}``.
    Persists the priors into *store* unless there are no documents.
    """
    empty = {
        "glossary": [],
        "entities": [],
        "metrics": [],
        "domain": "",
        "doc_count": 0,
        "llm_used": False,
    }
    try:
        docs = store.list_documents()
    except Exception as exc:  # noqa: BLE001
        logger.warning("doc analysis: could not list documents: %s", exc)
        return empty

    if not docs:
        return empty

    priors: dict[str, Any] | None = None
    llm_used = False
    try:
        from ..semantic.layer import complete_json_llm

        system, user = _build_prompt(docs)
        raw = complete_json_llm(system, user, max_tokens=1800)
        if raw is not None:
            priors = _sanitize(raw)
            llm_used = True
    except Exception as exc:  # noqa: BLE001 — degrade gracefully
        logger.warning("doc analysis LLM failed: %s", exc, exc_info=True)

    if priors is None:
        priors = {"glossary": [], "entities": [], "metrics": [], "domain": ""}

    # Persist into the context store (skip seeded demo rows in live mode).
    _persist(store, priors, exclude_seeded=(mode == "live"))

    return {**priors, "doc_count": len(docs), "llm_used": llm_used}
