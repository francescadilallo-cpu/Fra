"""Dynamic LLM system prompt for direct NL->SQL (frontend direct-LLM mode).

Built from the live semantic catalog so the prompt always reflects the loaded
dataset. Served by GET /api/semantic/system-prompt; live-mode callers get the
demo tables stripped. This is the sole survivor of the legacy query/aw_engine
module — the rest (its own Anthropic client, NL->SQL loop and DuckDB plumbing)
duplicated the semantic layer with a hardcoded provider and was removed.
"""

from __future__ import annotations


def build_system_prompt(
    catalog=None, layer=None, exclude_tables: frozenset[str] = frozenset()
) -> str:
    """Build a dynamic system prompt from semantic layer metadata.

    Uses catalog.get_schema_context() for the table schema section so the
    prompt automatically reflects the loaded dataset rather than any
    hardcoded schema. *exclude_tables* removes tables from the schema
    section (demo tables must not appear for live-mode users).
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
            schema_ctx = catalog.get_schema_context(exclude_tables=exclude_tables)
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
