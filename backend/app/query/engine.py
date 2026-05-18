"""
Natural language query engine.
Uses Claude to translate a question → SQL → execute → summarize.
"""
from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

import anthropic

from ..database import get_connection

# ── Claude client (module-level singleton) ─────────────────────────────────────

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


# ── System prompt (cached) ─────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a semantic data intelligence assistant for an Italian manufacturing company.
You have access to an ERP database with the following schema:

TABLE: customers
  - id (INTEGER PK)
  - name (TEXT) - company name
  - sector (TEXT) - industry sector (e.g. Automotive, Aerospace, Elettronica)
  - country (TEXT) - ISO country code, mostly 'IT'
  - vat_number (TEXT) - Italian VAT number
  - credit_limit (REAL) - credit limit in EUR

TABLE: products
  - id (INTEGER PK)
  - sku (TEXT UNIQUE) - stock keeping unit code like 'SKU-1000'
  - name (TEXT) - product name in Italian
  - category (TEXT) - product category
  - unit_price (REAL) - price per unit in EUR
  - unit_of_measure (TEXT) - unit (pz, kg, m, m², l, set)

TABLE: quotes
  - id (INTEGER PK)
  - customer_id (INTEGER FK → customers.id)
  - date (TEXT ISO date)
  - status (TEXT) - one of: draft, sent, accepted, rejected, expired
  - total_value (REAL) - total quote value in EUR
  - valid_until (TEXT ISO date)
  - created_by (TEXT) - sales agent name

TABLE: quote_lines
  - id (INTEGER PK)
  - quote_id (INTEGER FK → quotes.id)
  - product_id (INTEGER FK → products.id)
  - quantity (REAL)
  - unit_price (REAL)
  - discount_pct (REAL) - discount percentage
  - line_total (REAL)

TABLE: orders
  - id (INTEGER PK)
  - quote_id (INTEGER FK → quotes.id, nullable)
  - customer_id (INTEGER FK → customers.id)
  - date (TEXT ISO date)
  - status (TEXT) - one of: confirmed, in_production, shipped, delivered, cancelled
  - delivery_date (TEXT ISO date)
  - total_value (REAL)

TABLE: order_lines
  - id (INTEGER PK)
  - order_id (INTEGER FK → orders.id)
  - product_id (INTEGER FK → products.id)
  - quantity (REAL)
  - unit_price (REAL)
  - line_total (REAL)

This database is semantically mapped to an OWL ontology:
- customers → mfg:Customer (subClassOf mfg:Organization)
- products → mfg:Product
- quotes → mfg:Quote (mfg:hasCustomer → Customer)
- quote_lines → mfg:QuoteLineItem (mfg:hasProduct → Product)
- orders → mfg:Order (mfg:orderedBy → Customer, mfg:relatedToQuote → Quote)
- order_lines → mfg:OrderLineItem (mfg:orderHasProduct → Product)

Example questions you can answer:
- "Quali clienti hanno preventivi accettati questo mese?" (Which customers have accepted quotes this month?)
- "Mostra i 5 prodotti più venduti" (Show the top 5 best-selling products)
- "Qual è il valore totale degli ordini in produzione?" (What is the total value of orders in production?)
- "Quanti preventivi sono stati convertiti in ordini?" (How many quotes were converted to orders?)
- "Lista ordini consegnati negli ultimi 30 giorni" (List orders delivered in the last 30 days)
- "Quali clienti del settore automotive hanno ordini aperti?" (Which automotive customers have open orders?)

IMPORTANT RULES:
1. Always respond with valid JSON matching the exact structure below.
2. Generate safe, read-only SELECT queries only.
3. Use date('now') for current date comparisons in SQLite.
4. Limit results to 50 rows maximum unless asked for more.
5. If the question is ambiguous, make a reasonable interpretation.

Response JSON structure:
{
  "interpreted_as": "English interpretation of the question",
  "sql_query": "SELECT ...",
  "summary": "Italian summary of the results (2-3 sentences)"
}

The summary field will be filled after query execution based on actual results.
For now put a placeholder like "Elaborazione in corso..." in summary.
"""


def _extract_json(text: str) -> dict:
    """Extract JSON from Claude's response, handling markdown code blocks."""
    # Try direct parse first
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try extracting from markdown code block
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # Try finding first { ... } block
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not parse JSON from response: {text[:200]}")


def _execute_sql(sql: str, conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Execute a SELECT query and return rows as list of dicts."""
    # Safety: only allow SELECT statements
    clean = sql.strip().upper()
    if not clean.startswith("SELECT"):
        raise ValueError("Only SELECT queries are allowed")

    cursor = conn.execute(sql)
    columns = [desc[0] for desc in cursor.description]
    rows = cursor.fetchmany(50)
    return [dict(zip(columns, row)) for row in rows]


def _summarize_results(
    client: anthropic.Anthropic,
    question: str,
    interpreted_as: str,
    sql_query: str,
    results: list[dict[str, Any]],
) -> str:
    """Ask Claude to summarize the query results in Italian."""
    results_preview = results[:10]  # Send at most 10 rows for summarization
    results_str = json.dumps(results_preview, ensure_ascii=False, default=str)

    prompt = f"""Question: {question}
Interpreted as: {interpreted_as}
SQL executed: {sql_query}
Result rows (first {len(results_preview)} of {len(results)} total):
{results_str}

Write a concise summary in Italian (2-4 sentences) describing what the results show.
Include key numbers and insights. Be direct and professional.
Return ONLY the summary text, no JSON, no markdown."""

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text.strip()


# ── Public API ─────────────────────────────────────────────────────────────────

def run_query(question: str) -> dict[str, Any]:
    """
    Translate a natural language question to SQL, execute it, and return results.

    Returns:
        {
            "question": str,
            "interpreted_as": str,
            "sql_query": str,
            "results": list[dict],
            "summary": str
        }
    """
    client = _get_client()

    # Step 1: NL → SQL via Claude with prompt caching on system prompt
    translation_response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=600,
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
                "content": f"Question: {question}\n\nRespond with JSON only.",
            }
        ],
    )

    raw_text = translation_response.content[0].text
    parsed = _extract_json(raw_text)

    interpreted_as: str = parsed.get("interpreted_as", question)
    sql_query: str = parsed.get("sql_query", "")

    # Step 2: Execute SQL
    conn = get_connection()
    try:
        results = _execute_sql(sql_query, conn)
    except Exception as exc:
        # Return error info without crashing
        return {
            "question": question,
            "interpreted_as": interpreted_as,
            "sql_query": sql_query,
            "results": [],
            "summary": f"Errore nell'esecuzione della query: {exc}",
        }
    finally:
        conn.close()

    # Step 3: Summarize results in Italian
    summary = _summarize_results(client, question, interpreted_as, sql_query, results)

    return {
        "question": question,
        "interpreted_as": interpreted_as,
        "sql_query": sql_query,
        "results": results,
        "summary": summary,
    }
