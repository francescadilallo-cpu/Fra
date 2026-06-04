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
    """Build a dynamic system prompt from semantic layer metadata."""
    parts = [
        "You are a data intelligence assistant. "
        "Answer questions using the available data sources described below."
    ]

    if catalog is not None:
        try:
            entities = (
                catalog.list_entities() if hasattr(catalog, "list_entities") else []
            )
            metrics = catalog.list_metrics() if hasattr(catalog, "list_metrics") else []
            if entities:
                entity_names = ", ".join(e.get("name", "") for e in entities[:10])
                parts.append(f"\nAvailable entities: {entity_names}")
            if metrics:
                metric_names = ", ".join(
                    m.get("label") or m.get("name", "") for m in metrics[:5]
                )
                parts.append(f"\nKey metrics: {metric_names}")
        except Exception:
            pass

    parts.append(
        "\n\n== AVAILABLE TABLES ==\n"
        "\nTABLE: sales_order_header\n"
        "  - order_id (INTEGER PK) — unique order identifier\n"
        "  - order_number (TEXT) — human-readable order number\n"
        "  - order_date (TEXT ISO date) — date the order was placed\n"
        "  - ship_date (TEXT ISO date) — date shipped (may be NULL)\n"
        "  - due_date (TEXT ISO date) — expected delivery date\n"
        "  - status_code (INTEGER) — 1=In Process, 2=Approved, 3=Backordered, 4=Rejected, 5=Shipped, 6=Cancelled\n"
        "  - customer_ref (INTEGER FK → account.accountId)\n"
        "  - salesperson_ref (INTEGER FK → salesperson.salesperson_id)\n"
        "  - territory_ref (INTEGER FK → territory.territory_id)\n"
        "  - subtotal_amount (REAL) — net revenue before tax and freight\n"
        "  - tax_amount (REAL) — tax charged\n"
        "  - freight_amount (REAL) — freight cost\n"
        "  - total_due (REAL) — total billed (subtotal + tax + freight)\n"
        "  - currency_iso (TEXT) — currency code\n"
        "\nTABLE: sales_order_line\n"
        "  - order_id (INTEGER FK → sales_order_header.order_id)\n"
        "  - line_id (INTEGER) — line number within the order\n"
        "  - product_ref (INTEGER FK → pim_products.internal_id)\n"
        "  - qty (REAL) — quantity ordered\n"
        "  - unit_price (REAL) — price per unit\n"
        "  - unit_discount (REAL) — discount applied per unit\n"
        "  - line_total (REAL) — qty * (unit_price - unit_discount)\n"
        "  - offer_ref (INTEGER FK → offer.offer_id, may be NULL)\n"
        "\nTABLE: salesperson\n"
        "  - salesperson_id (INTEGER PK)\n"
        "  - territory_ref (INTEGER FK → territory.territory_id)\n"
        "  - sales_quota (REAL)\n"
        "  - bonus (REAL)\n"
        "  - commission_pct (REAL)\n"
        "  - sales_ytd (REAL) — year-to-date sales\n"
        "  - sales_last_year (REAL)\n"
        "\nTABLE: territory\n"
        "  - territory_id (INTEGER PK)\n"
        "  - territory_name (TEXT)\n"
        "  - country_code (TEXT)\n"
        "  - region_group (TEXT)\n"
        "  - sales_ytd (REAL)\n"
        "  - cost_ytd (REAL)\n"
        "\nTABLE: offer\n"
        "  - offer_id (INTEGER PK)\n"
        "  - description (TEXT)\n"
        "  - discount_pct (REAL)\n"
        "  - offer_type (TEXT)\n"
        "  - category (TEXT)\n"
        "  - start_date (TEXT ISO date)\n"
        "  - end_date (TEXT ISO date)\n"
        "  - min_qty (REAL)\n"
        "  - max_qty (REAL)\n"
        "\nTABLE: account\n"
        "  - accountId (INTEGER PK) — negative IDs indicate duplicate records\n"
        "  - accountType (TEXT) — customer type\n"
        "  - personRef (INTEGER FK → contact.contactId)\n"
        "  - storeRef (INTEGER)\n"
        "  - ragioneSociale (TEXT) — company name\n"
        "  - nomeContatto (TEXT) — contact name\n"
        "  - emailContatto (TEXT)\n"
        "  - telefonoContatto (TEXT)\n"
        "  - territoryHint (INTEGER)\n"
        "  - createdAt (TEXT ISO date)\n"
        "  - isActive (INTEGER) — 1=active\n"
        "\nTABLE: contact\n"
        "  - contactId (INTEGER PK)\n"
        "  - firstName (TEXT)\n"
        "  - middleName (TEXT)\n"
        "  - lastName (TEXT)\n"
        "  - personType (TEXT)\n"
        "  - email (TEXT)\n"
        "  - phone (TEXT)\n"
        "\nTABLE: address\n"
        "  - addressId (INTEGER PK)\n"
        "  - line1 (TEXT)\n"
        "  - line2 (TEXT)\n"
        "  - city (TEXT)\n"
        "  - stateProvinceId (INTEGER FK → state_province.stateId)\n"
        "  - postalCode (TEXT)\n"
        "\nTABLE: account_address\n"
        "  - accountRef (INTEGER FK → account.accountId)\n"
        "  - addressRef (INTEGER FK → address.addressId)\n"
        "  - addressType (TEXT)\n"
        "\nTABLE: state_province\n"
        "  - stateId (INTEGER PK)\n"
        "  - stateCode (TEXT)\n"
        "  - stateName (TEXT)\n"
        "  - countryCode (TEXT)\n"
        "  - territoryRef (INTEGER FK → territory.territory_id)\n"
        "\nTABLE: hr_employees\n"
        "  - MatricolaDip (TEXT) — employee ID, bridges to salesperson_ref\n"
        "  - Nome (TEXT) — first name\n"
        "  - Cognome (TEXT) — last name\n"
        "  - Mansione (TEXT) — job title/role\n"
        "  - Reparto (TEXT) — department\n"
        "  - GruppoReparto (TEXT) — department group\n"
        "  - DataAssunzione (TEXT ISO date) — hire date\n"
        "  - DataNascita (TEXT ISO date) — birth date\n"
        "  - Genere (TEXT)\n"
        "  - StatoCivile (TEXT)\n"
        "  - OreFerieResidue (TEXT) — remaining vacation hours\n"
        "  - OreMalattiaResidue (TEXT) — remaining sick leave hours\n"
        "  - RetribuzioneOraria (TEXT) — hourly rate\n"
        "  - FrequenzaPaga (TEXT) — pay frequency\n"
        "\nTABLE: pim_products\n"
        "  - sku (TEXT) — stock keeping unit\n"
        "  - internal_id (INTEGER PK) — bridges to sales_order_line.product_ref\n"
        "  - displayName (TEXT) — product name\n"
        "  - categoryPath (TEXT) — full category hierarchy path\n"
        "  - modelName (TEXT)\n"
        "  - color (TEXT)\n"
        "  - size (TEXT)\n"
        "  - weight (REAL)\n"
        "  - weightUnit (TEXT)\n"
        "  - standardCost (REAL) — production cost\n"
        "  - listPrice (REAL) — list price\n"
        "  - isMakeOnly (INTEGER) — 1=manufactured in-house only\n"
        "  - isPurchasable (INTEGER)\n"
        "  - sellStartDate (TEXT ISO date)\n"
        "  - sellEndDate (TEXT ISO date)\n"
        "\n== BRIDGE RELATIONSHIPS ==\n"
        "\n  ERP ↔ HR:    sales_order_header.salesperson_ref = hr_employees.MatricolaDip\n"
        "               (CAST one side to TEXT/INTEGER as needed for join)\n"
        "  ERP ↔ PIM:   sales_order_line.product_ref = pim_products.internal_id\n"
        "  ERP ↔ CRM:   sales_order_header.customer_ref = account.accountId\n"
        "\n== SQL DIALECT RULES ==\n"
        "\n- Database: DuckDB (not SQLite, not PostgreSQL)\n"
        "- Do NOT use backticks for identifiers; use double-quotes if quoting is needed\n"
        "- IMPORTANT: All date columns (order_date, ship_date, due_date, DataAssunzione, etc.)\n"
        "  are stored as TEXT in ISO format (YYYY-MM-DD). You MUST cast them before using\n"
        "  date functions: CAST(order_date AS DATE)\n"
        "  Examples:\n"
        "    YEAR(CAST(order_date AS DATE))\n"
        "    MONTH(CAST(order_date AS DATE))\n"
        "    DATE_TRUNC('month', CAST(order_date AS DATE))\n"
        "    EXTRACT(YEAR FROM CAST(order_date AS DATE))\n"
        "- String functions: CONCAT(), LOWER(), UPPER(), TRIM(), LIKE, ILIKE\n"
        "- CAST: CAST(col AS INTEGER), CAST(col AS REAL), CAST(col AS TEXT), CAST(col AS DATE)\n"
        "- Window functions supported: ROW_NUMBER(), RANK(), SUM() OVER(), etc.\n"
        "- LIMIT results to 100 rows maximum\n"
        "- Only generate read-only SELECT statements\n"
        "- Join hr_employees using: CAST(sales_order_header.salesperson_ref AS TEXT) = hr_employees.MatricolaDip\n"
        "\n== RESPONSE FORMAT ==\n"
        "\nAlways respond with valid JSON exactly matching this structure:\n"
        "{\n"
        '  "interpreted_as": "Clear English description of what the question is asking",\n'
        '  "sql": "SELECT ...",\n'
        '  "chart_hint": {"type": "bar"|"line"|"pie"|"table", "label_col": "column_name", "value_col": "column_name"} or null\n'
        "}\n"
        "\nRules:\n"
        "- interpreted_as: describe the question in clear English\n"
        "- sql: valid DuckDB SELECT query, limit 100 rows\n"
        "- chart_hint: suggest the best visualization, or null if tabular only\n"
        "- If the question is ambiguous, make the most reasonable interpretation\n"
        "- If the question cannot be answered with available data, return sql as "
        '"SELECT 1 AS unsupported" and explain in interpreted_as'
    )

    parts.append(
        "\nWhen asked about data, write precise SQL queries. "
        "If a question is ambiguous, ask for clarification. "
        "If data is not available in the schema, say so clearly."
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


def run_aw_query(question: str, erp=None, crm=None, hr_pim=None) -> dict[str, Any]:
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
    if any(
        t in sql_lower
        for t in [
            "sales_order_header",
            "sales_order_line",
            "salesperson",
            "territory",
            "offer",
        ]
    ):
        sources_touched.append("erp")
    if any(t in sql_lower for t in ["account", "contact", "address", "state_province"]):
        sources_touched.append("crm")
    if "hr_employees" in sql_lower:
        sources_touched.append("hr")
    if "pim_products" in sql_lower:
        sources_touched.append("pim")

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
