"""Smart Connect analysis.

Profiles connected source tables and uses the LLM to propose a business data
model — entities, metrics and relations. The analysis is *read-only*: it returns
proposals for the user to review and approve. Nothing is persisted here.

The flow this powers:

    connect source  →  ANALYZE (this module)  →  review/approve  →  apply

Design notes:
- Profiling is sample-based (uses the 5 rows already fetched by
  ``get_schema_info()``), so it adds no extra DB round-trips and stays cheap on
  memory-constrained deployments. Deeper cardinality analysis is a later step.
- The LLM call degrades gracefully: if no provider is configured the endpoint
  still returns the profiles plus a deterministic one-entity-per-table fallback.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# ── Heuristic thresholds ──────────────────────────────────────────────────────
_HIGH_NULL_RATE = 0.30  # columns nullier than this dent the quality score
_NULL_PENALTY = 12  # quality points lost per high-null column
_MAX_TABLES_TO_LLM = 24  # cap prompt size on wide workspaces
_MAX_COLS_TO_LLM = 40  # cap columns per table in the prompt
_SAMPLE_ROWS_TO_LLM = 3  # sample rows per table sent to the LLM
_VALUE_TRUNCATE = 48  # max chars per sampled value in the prompt


def _hashable(v: Any) -> Any:
    """Make a sampled value hashable for distinct-counting."""
    if isinstance(v, (list, dict, set)):
        return repr(v)
    return v


def profile_table(info: dict) -> dict[str, Any]:
    """Lightweight quality profile for one table from its schema info.

    ``info`` is one value of ``get_schema_info()``:
    ``{columns: [{name, type}], row_count: int, sample: [dict]}``.
    """
    columns = info.get("columns", []) or []
    sample = info.get("sample", []) or []
    row_count = int(info.get("row_count", 0) or 0)
    n = len(sample) or 1

    col_profiles: list[dict[str, Any]] = []
    for col in columns:
        name = col.get("name", "")
        values = [r.get(name) for r in sample]
        non_null = [v for v in values if v is not None]
        nulls = len(values) - len(non_null)
        distinct = len({_hashable(v) for v in non_null})
        col_profiles.append(
            {
                "name": name,
                "type": col.get("type", ""),
                "null_rate": round(nulls / n, 3),
                "distinct_in_sample": distinct,
                # A column where every sampled value is distinct (and there is
                # more than one) is a primary-key candidate.
                "looks_unique": distinct == len(non_null) and distinct > 1,
            }
        )

    high_null = [c["name"] for c in col_profiles if c["null_rate"] >= _HIGH_NULL_RATE]
    quality_score = max(0, 100 - _NULL_PENALTY * len(high_null))

    return {
        "row_count": row_count,
        "column_count": len(columns),
        "columns": col_profiles,
        "high_null_columns": high_null,
        "quality_score": quality_score,
    }


def _truncate(v: Any) -> str:
    s = "NULL" if v is None else str(v)
    return s[:_VALUE_TRUNCATE] + "…" if len(s) > _VALUE_TRUNCATE else s


def _priors_block(priors: dict | None) -> str:
    """Render document-derived business context as a hint block for the prompt.

    Lets the model align entity/metric names with the user's own vocabulary
    (extracted from uploaded documents) instead of raw column names.
    """
    if not priors:
        return ""
    lines: list[str] = []
    domain = (priors.get("domain") or "").strip()
    if domain:
        lines.append(f"Business domain: {domain}")
    glossary = priors.get("glossary") or []
    if glossary:
        terms = "; ".join(
            f"{g.get('term')}={g.get('definition')}" for g in glossary[:20]
        )
        lines.append(f"Glossary: {terms}")
    ents = priors.get("entities") or []
    if ents:
        lines.append(
            "Known business entities: "
            + ", ".join(str(e.get("name")) for e in ents[:20])
        )
    mets = priors.get("metrics") or []
    if mets:
        lines.append(
            "Known business metrics: "
            + ", ".join(str(m.get("name")) for m in mets[:20])
        )
    if not lines:
        return ""
    return (
        "\n\nBusiness context (hints from the user's documents — prefer this "
        "vocabulary when naming entities and metrics):\n  " + "\n  ".join(lines)
    )


def _build_prompt(
    tables: dict[str, dict], profiles: dict[str, dict], priors: dict | None = None
) -> tuple[str, str]:
    """Compose the (system, user) prompts for the proposal LLM call."""
    system = (
        "You are a senior data architect helping a non-technical business user "
        "turn raw database tables into a clean, useful data model. You are given "
        "each table's schema and a few sample rows. Respond with JSON only, no "
        "prose.\n\n"
        "Produce:\n"
        "1. entities — one per table. Give a clear business name (singular, "
        "Title Case, e.g. 'Customer' not 'cust_tbl'), a one-sentence plain-"
        "language description of what it represents, the most likely primary "
        "key column, and synonyms (other business terms users might use for it, "
        "e.g. ['client','account'] for Customer).\n"
        "2. metrics — 3 to 6 genuinely useful business metrics across the "
        "tables. Each needs a business name, a one-sentence description, and a "
        "SQL formula referencing real columns as table.column (e.g. "
        "SUM(orders.total_amount)). Prefer revenue, counts, averages, rates.\n"
        "3. relations — likely foreign-key links between tables, inferred from "
        "matching column names/values (e.g. orders.customer_id → customers.id).\n\n"
        "Every item carries a confidence number from 0 to 1. Use EXACTLY this "
        "JSON shape:\n"
        '{"entities":[{"table":"","name":"","description":"",'
        '"primary_key":"","synonyms":[],"confidence":0.0}],'
        '"metrics":[{"name":"","description":"","formula":"","unit":"",'
        '"confidence":0.0}],'
        '"relations":[{"from_table":"","to_table":"","via_column":"",'
        '"description":"","confidence":0.0}]}'
    )

    lines: list[str] = []
    for tname, info in list(tables.items())[:_MAX_TABLES_TO_LLM]:
        prof = profiles.get(tname, {})
        cols = (info.get("columns") or [])[:_MAX_COLS_TO_LLM]
        col_str = ", ".join(f"{c['name']}:{c['type']}" for c in cols)
        lines.append(
            f"TABLE {tname} (rows≈{prof.get('row_count', 0)}):\n  columns: {col_str}"
        )
        sample = (info.get("sample") or [])[:_SAMPLE_ROWS_TO_LLM]
        for i, row in enumerate(sample, 1):
            cells = ", ".join(f"{k}={_truncate(v)}" for k, v in row.items())
            lines.append(f"  sample{i}: {cells}")
    user = "Tables to model:\n\n" + "\n".join(lines) + _priors_block(priors)
    return system, user


def _sanitize_proposal(raw: dict, valid_tables: set[str]) -> dict[str, Any]:
    """Validate and clamp the LLM output to the contract, dropping junk."""

    def _conf(x: Any) -> float:
        try:
            return max(0.0, min(1.0, float(x)))
        except (TypeError, ValueError):
            return 0.5

    entities = []
    for e in raw.get("entities", []) or []:
        if not isinstance(e, dict):
            continue
        table = str(e.get("table", "")).strip()
        if table not in valid_tables:
            continue
        syns = [str(s).strip() for s in (e.get("synonyms") or []) if str(s).strip()][
            :20
        ]
        entities.append(
            {
                "table": table,
                "name": str(e.get("name", "") or table).strip(),
                "description": str(e.get("description", "")).strip(),
                "primary_key": str(e.get("primary_key", "")).strip(),
                "synonyms": syns,
                "confidence": _conf(e.get("confidence")),
            }
        )

    metrics = []
    for m in raw.get("metrics", []) or []:
        if not isinstance(m, dict):
            continue
        formula = str(m.get("formula", "")).strip()
        name = str(m.get("name", "")).strip()
        if not name or not formula:
            continue
        metrics.append(
            {
                "name": name,
                "description": str(m.get("description", "")).strip(),
                "formula": formula,
                "unit": str(m.get("unit", "")).strip(),
                "confidence": _conf(m.get("confidence")),
            }
        )

    relations = []
    for r in raw.get("relations", []) or []:
        if not isinstance(r, dict):
            continue
        ft = str(r.get("from_table", "")).strip()
        tt = str(r.get("to_table", "")).strip()
        if ft not in valid_tables or tt not in valid_tables or ft == tt:
            continue
        relations.append(
            {
                "from_table": ft,
                "to_table": tt,
                "via_column": str(r.get("via_column", "")).strip(),
                "description": str(r.get("description", "")).strip(),
                "confidence": _conf(r.get("confidence")),
            }
        )

    return {"entities": entities, "metrics": metrics, "relations": relations}


def _fallback_proposal(tables: dict[str, dict], profiles: dict[str, dict]) -> dict:
    """Deterministic proposal when no LLM is configured: one entity per table,
    primary key guessed from the first unique-looking column. No metrics or
    relations — those genuinely need the LLM."""
    entities = []
    for tname, _info in tables.items():
        prof = profiles.get(tname, {})
        pk = next(
            (c["name"] for c in prof.get("columns", []) if c.get("looks_unique")),
            "",
        )
        entities.append(
            {
                "table": tname,
                "name": tname.replace("_", " ").title().replace(" ", ""),
                "description": "",
                "primary_key": pk,
                "confidence": 0.3,
            }
        )
    return {"entities": entities, "metrics": [], "relations": []}


def analyze(
    schema_info: dict[str, dict],
    table_names: list[str],
    priors: dict | None = None,
) -> dict[str, Any]:
    """Profile the given tables and propose a business data model.

    Returns ``{tables, proposal, llm_used}`` where ``tables`` maps table name →
    profile and ``proposal`` holds ``entities``/``metrics``/``relations``.

    *priors* are optional document-derived business hints (glossary, entity and
    metric names, domain) that bias the proposal toward the user's vocabulary.
    """
    tables = {t: schema_info[t] for t in table_names if t in schema_info}
    profiles = {t: profile_table(info) for t, info in tables.items()}

    if not tables:
        return {
            "tables": {},
            "proposal": {"entities": [], "metrics": [], "relations": []},
            "llm_used": False,
        }

    llm_used = False
    proposal: dict[str, Any] | None = None
    try:
        from .layer import complete_json_llm

        system, user = _build_prompt(tables, profiles, priors)
        raw = complete_json_llm(system, user, max_tokens=1800)
        if raw is not None:
            proposal = _sanitize_proposal(raw, set(tables.keys()))
            llm_used = True
    except Exception as exc:  # noqa: BLE001 — degrade to deterministic fallback
        logger.warning("Smart Connect LLM proposal failed: %s", exc, exc_info=True)

    if proposal is None:
        proposal = _fallback_proposal(tables, profiles)

    return {"tables": profiles, "proposal": proposal, "llm_used": llm_used}


def profile_only(
    schema_info: dict[str, dict], table_names: list[str]
) -> dict[str, Any]:
    """Quality profiles without LLM — fast stats-only analysis for inline display."""
    return {t: profile_table(schema_info[t]) for t in table_names if t in schema_info}
