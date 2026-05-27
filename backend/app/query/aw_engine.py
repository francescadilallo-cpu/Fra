"""
AdventureWorks Unified Query Engine.

Loads all 4 sources (ERP, CRM, HR, PIM) into a single DuckDB in-memory
instance and exposes a Claude-powered NL→SQL→execute pipeline.

Tables registered in DuckDB (no schema prefix needed in SQL):
  ERP:  sales_order_header, sales_order_line, salesperson, territory, offer
  CRM:  account, contact, address, account_address, state_province
  HR:   hr_employees  (columns: MatricolaDip, Nome, Cognome, Mansione, Reparto,
                        GruppoReparto, DataAssunzione, DataNascita, Genere,
                        StatoCivile, OreFerieResidue, OreMalattiaResidue,
                        RetribuzioneOraria, FrequenzaPaga)
  PIM:  pim_products  (columns: sku, internal_id, displayName, categoryPath,
                        modelName, color, size, weight, weightUnit, standardCost,
                        listPrice, isMakeOnly, isPurchasable, sellStartDate,
                        sellEndDate)
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any

import anthropic
import duckdb
import pandas as pd

logger = logging.getLogger(__name__)

# ── Singleton unified DuckDB connection ────────────────────────────────────────

_UNIFIED_CONN: dict[str, duckdb.DuckDBPyConnection] = {}

# ── Claude client singleton ────────────────────────────────────────────────────

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


# ── System prompt ──────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a data intelligence assistant for an AdventureWorks manufacturing company.
You have access to a unified DuckDB in-memory database with data from 4 sources.

== SOURCE 1: ERP (OrionSales / AdventureWorks) ==

TABLE: sales_order_header
  - order_id (INTEGER PK) — unique order identifier
  - order_number (TEXT) — human-readable order number (e.g. SO43659)
  - order_date (TEXT ISO date) — date the order was placed
  - ship_date (TEXT ISO date) — date shipped (may be NULL)
  - due_date (TEXT ISO date) — expected delivery date
  - status_code (INTEGER) — 1=In Process, 2=Approved, 3=Backordered, 4=Rejected, 5=Shipped, 6=Cancelled
  - customer_ref (INTEGER FK → CRM account.accountId) — bridges to CRM
  - salesperson_ref (INTEGER FK → salesperson.salesperson_id) — bridges to HR via MatricolaDip
  - territory_ref (INTEGER FK → territory.territory_id)
  - subtotal_amount (REAL) — net revenue before tax and freight
  - tax_amount (REAL) — tax charged
  - freight_amount (REAL) — freight cost
  - total_due (REAL) — total billed (subtotal + tax + freight)
  - currency_iso (TEXT) — currency code (USD)

TABLE: sales_order_line
  - order_id (INTEGER FK → sales_order_header.order_id)
  - line_id (INTEGER) — line number within the order
  - product_ref (INTEGER FK → pim_products.internal_id) — bridges to PIM
  - qty (REAL) — quantity ordered
  - unit_price (REAL) — price per unit
  - unit_discount (REAL) — discount applied per unit
  - line_total (REAL) — qty * (unit_price - unit_discount)
  - offer_ref (INTEGER FK → offer.offer_id, may be NULL)

TABLE: salesperson
  - salesperson_id (INTEGER PK)
  - territory_ref (INTEGER FK → territory.territory_id)
  - sales_quota (REAL)
  - bonus (REAL)
  - commission_pct (REAL)
  - sales_ytd (REAL) — year-to-date sales
  - sales_last_year (REAL)

TABLE: territory
  - territory_id (INTEGER PK)
  - territory_name (TEXT) — e.g. "Northwest", "Canada", "France"
  - country_code (TEXT) — e.g. "US", "CA", "FR"
  - region_group (TEXT) — e.g. "North America", "Europe", "Pacific"
  - sales_ytd (REAL)
  - cost_ytd (REAL)

TABLE: offer
  - offer_id (INTEGER PK)
  - description (TEXT)
  - discount_pct (REAL)
  - offer_type (TEXT)
  - category (TEXT)
  - start_date (TEXT ISO date)
  - end_date (TEXT ISO date)
  - min_qty (REAL)
  - max_qty (REAL)

== SOURCE 2: CRM (ClientHub) ==

TABLE: account
  - accountId (INTEGER PK) — negative IDs indicate duplicate records
  - accountType (TEXT) — customer type
  - personRef (INTEGER FK → contact.contactId)
  - storeRef (INTEGER)
  - ragioneSociale (TEXT) — company name (Italian)
  - nomeContatto (TEXT) — contact name
  - emailContatto (TEXT)
  - telefonoContatto (TEXT)
  - territoryHint (INTEGER) — approximate territory_id
  - createdAt (TEXT ISO date)
  - isActive (INTEGER) — 1=active

TABLE: contact
  - contactId (INTEGER PK)
  - firstName (TEXT)
  - middleName (TEXT)
  - lastName (TEXT)
  - personType (TEXT)
  - email (TEXT)
  - phone (TEXT)

TABLE: address
  - addressId (INTEGER PK)
  - line1 (TEXT)
  - line2 (TEXT)
  - city (TEXT)
  - stateProvinceId (INTEGER FK → state_province.stateId)
  - postalCode (TEXT)

TABLE: account_address
  - accountRef (INTEGER FK → account.accountId)
  - addressRef (INTEGER FK → address.addressId)
  - addressType (TEXT) — e.g. "Main Office", "Shipping"

TABLE: state_province
  - stateId (INTEGER PK)
  - stateCode (TEXT)
  - stateName (TEXT)
  - countryCode (TEXT)
  - territoryRef (INTEGER FK → territory.territory_id)

== SOURCE 3: HR (dipendenti_hr.csv) ==

TABLE: hr_employees
  - MatricolaDip (TEXT) — employee ID, bridges to ERP salesperson_ref
  - Nome (TEXT) — first name
  - Cognome (TEXT) — last name
  - Mansione (TEXT) — job title/role
  - Reparto (TEXT) — department
  - GruppoReparto (TEXT) — department group
  - DataAssunzione (TEXT ISO date) — hire date
  - DataNascita (TEXT ISO date) — birth date
  - Genere (TEXT)
  - StatoCivile (TEXT)
  - OreFerieResidue (TEXT) — remaining vacation hours
  - OreMalattiaResidue (TEXT) — remaining sick leave hours
  - RetribuzioneOraria (TEXT) — hourly rate
  - FrequenzaPaga (TEXT) — pay frequency

== SOURCE 4: PIM (product_catalog_pim.json) ==

TABLE: pim_products
  - sku (TEXT) — stock keeping unit
  - internal_id (INTEGER PK) — bridges to ERP sales_order_line.product_ref
  - displayName (TEXT) — product name
  - categoryPath (TEXT) — full category hierarchy path
  - modelName (TEXT)
  - color (TEXT)
  - size (TEXT)
  - weight (REAL)
  - weightUnit (TEXT)
  - standardCost (REAL) — production cost
  - listPrice (REAL) — list price
  - isMakeOnly (INTEGER) — 1=manufactured in-house only
  - isPurchasable (INTEGER)
  - sellStartDate (TEXT ISO date)
  - sellEndDate (TEXT ISO date)

== BRIDGE RELATIONSHIPS ==

  ERP ↔ HR:    sales_order_header.salesperson_ref = hr_employees.MatricolaDip
               (CAST one side to TEXT/INTEGER as needed for join)
  ERP ↔ PIM:   sales_order_line.product_ref = pim_products.internal_id
  ERP ↔ CRM:   sales_order_header.customer_ref = account.accountId

== SQL DIALECT RULES ==

- Database: DuckDB (not SQLite, not PostgreSQL)
- Do NOT use backticks for identifiers; use double-quotes if quoting is needed
- IMPORTANT: All date columns (order_date, ship_date, due_date, DataAssunzione, etc.)
  are stored as TEXT in ISO format (YYYY-MM-DD). You MUST cast them before using
  date functions: CAST(order_date AS DATE)
  Examples:
    YEAR(CAST(order_date AS DATE))
    MONTH(CAST(order_date AS DATE))
    DATE_TRUNC('month', CAST(order_date AS DATE))
    EXTRACT(YEAR FROM CAST(order_date AS DATE))
- String functions: CONCAT(), LOWER(), UPPER(), TRIM(), LIKE, ILIKE
- CAST: CAST(col AS INTEGER), CAST(col AS REAL), CAST(col AS TEXT), CAST(col AS DATE)
- Window functions supported: ROW_NUMBER(), RANK(), SUM() OVER(), etc.
- LIMIT results to 100 rows maximum
- Only generate read-only SELECT statements
- Join hr_employees using: CAST(sales_order_header.salesperson_ref AS TEXT) = hr_employees.MatricolaDip

== RESPONSE FORMAT ==

Always respond with valid JSON exactly matching this structure:
{
  "interpreted_as": "Clear English description of what the question is asking",
  "sql": "SELECT ...",
  "chart_hint": {"type": "bar"|"line"|"pie"|"table", "label_col": "column_name", "value_col": "column_name"} or null
}

Rules:
- interpreted_as: describe the question in clear English
- sql: valid DuckDB SELECT query, limit 100 rows
- chart_hint: suggest the best visualization, or null if tabular only
- If the question is ambiguous, make the most reasonable interpretation
- If the question cannot be answered with available data, return sql as "SELECT 1 AS unsupported" and explain in interpreted_as
"""


# ── Unified DuckDB connection ──────────────────────────────────────────────────

def get_unified_conn(erp, crm, hr_pim) -> duckdb.DuckDBPyConnection:
    """
    Build (or return cached) a unified DuckDB in-memory connection with all
    4 data sources registered as tables.

    Parameters
    ----------
    erp:    PostgresConnector instance
    crm:    SQLiteConnector instance
    hr_pim: FileConnector instance
    """
    if "default" in _UNIFIED_CONN:
        return _UNIFIED_CONN["default"]

    logger.info("Building unified DuckDB connection from all 4 sources…")
    conn = duckdb.connect(database=":memory:")

    # ── ERP tables ──────────────────────────────────────────────────────────
    erp_tables = [
        "sales_order_header",
        "sales_order_line",
        "salesperson",
        "territory",
        "offer",
    ]
    for table in erp_tables:
        try:
            rows = erp.execute_query(f"SELECT * FROM {table}")
            df = pd.DataFrame(rows)
            conn.register(table, df)
            logger.info("ERP table %s: %d rows", table, len(df))
        except Exception as exc:
            logger.warning("Could not load ERP table %s: %s", table, exc)
            conn.register(table, pd.DataFrame())

    # ── CRM tables ──────────────────────────────────────────────────────────
    crm_tables = [
        "account",
        "contact",
        "address",
        "account_address",
        "state_province",
    ]
    for table in crm_tables:
        try:
            rows = crm.execute_query(f"SELECT * FROM {table}")
            df = pd.DataFrame(rows)
            conn.register(table, df)
            logger.info("CRM table %s: %d rows", table, len(df))
        except Exception as exc:
            logger.warning("Could not load CRM table %s: %s", table, exc)
            conn.register(table, pd.DataFrame())

    # ── HR (FileConnector) ───────────────────────────────────────────────────
    try:
        hr_rows = hr_pim._ensure_hr()
        hr_df = pd.DataFrame(hr_rows)
        conn.register("hr_employees", hr_df)
        logger.info("HR table hr_employees: %d rows", len(hr_df))
    except Exception as exc:
        logger.warning("Could not load HR data: %s", exc)
        conn.register("hr_employees", pd.DataFrame())

    # ── PIM (FileConnector) ──────────────────────────────────────────────────
    try:
        pim_rows = hr_pim._ensure_pim()
        pim_df = pd.DataFrame(pim_rows)
        conn.register("pim_products", pim_df)
        logger.info("PIM table pim_products: %d rows", len(pim_df))
    except Exception as exc:
        logger.warning("Could not load PIM data: %s", exc)
        conn.register("pim_products", pd.DataFrame())

    _UNIFIED_CONN["default"] = conn
    logger.info("Unified DuckDB connection ready.")
    return conn


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

def run_aw_query(question: str, erp, crm, hr_pim) -> dict[str, Any]:
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
    unified = get_unified_conn(erp, crm, hr_pim)
    rows: list[dict[str, Any]] = []
    sql_error: str | None = None

    try:
        if not sql.strip().upper().startswith("SELECT"):
            raise ValueError("Only SELECT queries are allowed")
        result_df = unified.execute(sql).df()
        # Limit to 100 rows
        result_df = result_df.head(100)
        # Convert to list of dicts, handling NaN/NaT
        rows = result_df.where(result_df.notna(), other=None).to_dict(orient="records")
    except Exception as exc:
        sql_error = str(exc)
        logger.error("SQL execution error: %s\nSQL: %s", exc, sql)

    total_rows = len(rows)

    # Determine sources touched based on which table names appear in the SQL
    sources_touched: list[str] = []
    sql_lower = sql.lower()
    if any(t in sql_lower for t in ["sales_order_header", "sales_order_line", "salesperson", "territory", "offer"]):
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
