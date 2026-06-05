"""
Unified Query Engine.

Loads all available data sources into a single DuckDB in-memory
instance and exposes a Claude-powered NL→SQL→execute pipeline.

Tables registered in DuckDB (no schema prefix needed in SQL) are
discovered dynamically from the active scenario / semantic layer.
"""

from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from typing import Any

import anthropic
import duckdb

logger = logging.getLogger(__name__)

# Scenario path — same relative position as main.py uses
_SCENARIO_PATH = Path(__file__).parent.parent.parent.parent / "test_scenario"

# ── Claude client singleton ────────────────────────────────────────────────────

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


# ── System prompt ──────────────────────────────────────────────────────────────


def build_system_prompt(catalog=None, layer=None) -> str:
    """Build a dynamic system prompt from semantic layer metadata.

    Uses catalog.get_schema_context() for the table schema section so the
    prompt automatically reflects the loaded dataset rather than any
    hardcoded schema.
    """
    parts = [
        "You are a data intelligence assistant. "
        "Answer questions using the available data sources described below. "
        "Respond in the same language as the question (English or Italian)."
    ]

    # Schema section — always dynamic from catalog
    schema_ctx = ""
    if catalog is not None:
        try:
            schema_ctx = catalog.get_schema_context()
        except Exception:
            pass

    if schema_ctx and schema_ctx.strip() not in ("", "No schema available."):
        parts.append(f"\n\n== AVAILABLE TABLES ==\n\n{schema_ctx}")
    else:
        parts.append(
            "\n\nNo schema information available yet. "
            "Ask the user to load data sources first."
        )

    # Bridges from semantic layer relations (if available)
    if layer is not None:
        try:
            draft = getattr(layer, "draft", None)
            rels = getattr(draft, "relations", []) if draft else []
            if rels:
                bridge_lines = ["\n\n== BRIDGE RELATIONSHIPS ==\n"]
                for rel in rels[:10]:
                    fe = rel.get("from_entity", "")
                    te = rel.get("to_entity", "")
                    ff = rel.get("from_field", "")
                    tf = rel.get("to_field", "")
                    bridge_lines.append(f"  {fe}.{ff} = {te}.{tf}")
                parts.append("\n".join(bridge_lines))
        except Exception:
            pass

    parts.append(
        "\n\n== SQL DIALECT RULES =="
        "\n- Database: DuckDB (not SQLite, not PostgreSQL)"
        "\n- Use double-quotes for identifiers if quoting is needed, never backticks"
        "\n- Date columns are stored as TEXT in ISO format (YYYY-MM-DD);"
        " cast before using date functions: CAST(col AS DATE)"
        "\n- Only generate read-only SELECT statements"
        "\n- LIMIT results to 100 rows maximum"
        "\n- Window functions supported: ROW_NUMBER(), RANK(), SUM() OVER(), etc."
    )

    parts.append(
        "\n\n== RESPONSE FORMAT =="
        "\nAlways respond with valid JSON exactly matching this structure:\n"
        "{\n"
        '  "interpreted_as": "Clear description of what the question is asking",\n'
        '  "sql": "SELECT ...",\n'
        '  "chart_hint": {"type": "bar"|"line"|"pie"|"table",'
        ' "label_col": "column_name", "value_col": "column_name"} or null\n'
        "}\n"
        "\n- interpreted_as: describe the question clearly"
        "\n- sql: valid DuckDB SELECT, limit 100 rows"
        "\n- chart_hint: best visualization, or null if tabular only"
        "\n- If question cannot be answered: sql = 'SELECT 1 AS unsupported', explain in interpreted_as"
    )

    return "\n".join(parts)


SYSTEM_PROMPT = build_system_prompt()  # generic fallback, overridden at call time


# ── Unified DuckDB connection (scalable — persistent file or live pushdown) ────


def _get_unified_conn() -> duckdb.DuckDBPyConnection:
    """
    Return a DuckDB connection with all 4 sources available as flat tables.

    Delegates to DuckDBSourceManager which:
    - First startup:   builds a persistent .duckdb snapshot (one-time, ~2-3 s)
    - Subsequent runs: opens the snapshot read-only (<100 ms, no re-parsing)
    - Live mode:       when ERP_POSTGRES_DSN / CRM_SQLITE_PATH / HR_CSV_PATH /
                       PIM_JSON_PATH env vars are set, uses DuckDB native readers
                       (postgres_scanner, sqlite_scanner, read_csv, read_json)
                       with full predicate pushdown — no copy into RAM.
    """
    from ..connectors.duckdb_source_manager import get_source_manager

    return get_source_manager(_SCENARIO_PATH).get_connection()


# ── JSON extraction helper ─────────────────────────────────────────────────────


def _extract_json(text: str) -> dict:
    """Extract JSON from Claude's response, handling markdown code blocks."""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not parse JSON from response: {text[:300]}")


# ── Main query function ────────────────────────────────────────────────────────


def _build_table_source_map(catalog) -> dict[str, str]:
    """Return {table_name: source_id} from catalog entity metadata (public API only)."""
    mapping: dict[str, str] = {}
    try:
        names = catalog.list_entities()
        for name in names:
            entity = catalog.get_entity(name)
            if entity is None:
                continue
            for src in entity.sources:
                if isinstance(src, dict) and src.get("source"):
                    mapping[name] = src["source"]
                    break
    except Exception:
        pass
    return mapping


def run_aw_query(
    question: str, erp=None, crm=None, hr_pim=None, catalog=None
) -> dict[str, Any]:
    """
    Translate a natural-language question to SQL using Claude, execute it on
    the unified DuckDB connection, and return a structured result dict.

    Returns a dict matching the AskResult Pydantic model fields:
        question, interpreted_as, sql_used, rows, total_rows, summary,
        sources_touched, provenance, latency_ms, disambiguation_required,
        candidates, ambiguity_error, chart_hint
    """
    t_start = time.time()
    client = _get_client()

    # ── Step 1: NL → SQL via Claude (with prompt caching) ──────────────────
    try:
        translation_response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=800,
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Question: {question}\n\n"
                        "Respond with JSON only (no markdown, no explanation)."
                    ),
                }
            ],
        )
        raw_text = translation_response.content[0].text
        parsed = _extract_json(raw_text)
    except Exception as exc:
        logger.error("Claude NL→SQL failed: %s", exc)
        latency_ms = round((time.time() - t_start) * 1000, 1)
        return {
            "question": question,
            "interpreted_as": question,
            "sql_used": None,
            "rows": [],
            "total_rows": 0,
            "summary": f"Errore nella generazione della query: {exc}",
            "sources_touched": [],
            "provenance": {},
            "latency_ms": latency_ms,
            "disambiguation_required": False,
            "candidates": [],
            "ambiguity_error": False,
            "chart_hint": None,
        }

    interpreted_as: str = parsed.get("interpreted_as", question)
    sql: str = parsed.get("sql", "")
    chart_hint: dict | None = parsed.get("chart_hint")

    # ── Step 2: Execute SQL on unified DuckDB ───────────────────────────────
    rows: list[dict[str, Any]] = []
    sql_error: str | None = None

    unified = _get_unified_conn()
    try:
        if not sql.strip().upper().startswith("SELECT"):
            raise ValueError("Only SELECT queries are allowed")
        result_df = unified.execute(sql).df()
        result_df = result_df.head(100)
        rows = result_df.where(result_df.notna(), other=None).to_dict(orient="records")
    except Exception as exc:
        sql_error = str(exc)
        logger.error("SQL execution error: %s\nSQL: %s", exc, sql)
    finally:
        try:
            unified.close()
        except Exception:
            pass

    total_rows = len(rows)

    # Determine sources touched based on which table names appear in the SQL
    sources_touched: list[str] = []
    sql_lower = sql.lower()
    if catalog is not None:
        table_source_map = _build_table_source_map(catalog)
        seen_sources: set[str] = set()
        for table, source_id in table_source_map.items():
            if table.lower() in sql_lower and source_id not in seen_sources:
                sources_touched.append(source_id)
                seen_sources.add(source_id)

    # ── Step 3: Generate summary via Claude ─────────────────────────────────
    summary = ""
    if sql_error:
        summary = f"Errore nell'esecuzione della query SQL: {sql_error}"
    elif rows:
        try:
            preview = rows[:10]
            preview_str = json.dumps(preview, ensure_ascii=False, default=str)
            summary_response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=300,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            f"Domanda: {question}\n"
                            f"Interpretata come: {interpreted_as}\n"
                            f"SQL eseguito: {sql}\n"
                            f"Prime {len(preview)} righe di {total_rows} totali:\n"
                            f"{preview_str}\n\n"
                            "Scrivi un breve riassunto in italiano (2-4 frasi) dei risultati. "
                            "Includi numeri chiave e insight. Sii diretto e professionale. "
                            "Rispondi SOLO con il testo del riassunto, senza JSON o markdown."
                        ),
                    }
                ],
            )
            summary = summary_response.content[0].text.strip()
        except Exception as exc:
            logger.warning("Summary generation failed: %s", exc)
            summary = f"Query eseguita con successo: {total_rows} righe restituite."
    else:
        summary = "Nessun risultato trovato per questa query."

    latency_ms = round((time.time() - t_start) * 1000, 1)

    return {
        "question": question,
        "interpreted_as": interpreted_as,
        "sql_used": sql if sql else None,
        "rows": rows,
        "total_rows": total_rows,
        "summary": summary,
        "sources_touched": sources_touched,
        "provenance": {
            "sql_error": sql_error,
            "model": "claude-sonnet-4-6",
            "sources": sources_touched,
        },
        "latency_ms": latency_ms,
        "disambiguation_required": False,
        "candidates": [],
        "ambiguity_error": False,
        "chart_hint": chart_hint,
    }
