"""PII masking — column-level masking rules applied server-side.

Values matching an active rule are masked BEFORE data leaves the API:
the Data Explorer dump (``/api/data/{table}``) and every query answer
(``/api/semantic/ask``) return masked values, so neither the UI nor any
downstream consumer ever sees the raw content of a protected column.

Rules are explicit and human-approved (HITL philosophy): ``suggest_rules``
proposes candidates from column NAMES only (codice_fiscale, email, iban, …
— deterministic, no data is read), and an admin turns suggestions into
rules. A rule is table-scoped or global (empty table = the column name is
masked wherever it appears — SQL aliases can rename columns, so global
rules are the conservative default).

Strategies:
- ``full``:    ``•••••`` (nothing survives)
- ``partial``: last 4 characters survive (``•••• 1234``)
- ``email``:   first character + domain survive (``m•••@example.com``)
"""

from __future__ import annotations

import logging
import re
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..paths import data_dir

logger = logging.getLogger(__name__)

STRATEGIES = ("full", "partial", "email")

_MASK = "•••••"

# Column-name patterns → suggested strategy. Names only — the scanner never
# reads row data. EN + IT.
_SUGGESTION_PATTERNS: list[tuple[re.Pattern, str, str]] = [
    (
        re.compile(r"codice_?fiscale|(^|_)cf($|_)|ssn|social_?security", re.I),
        "full",
        "national identifier",
    ),
    (re.compile(r"(^|_)e?_?mail($|_)", re.I), "email", "email address"),
    (
        re.compile(r"phone|telefono|(^|_)tel($|_)|mobile|cellulare|fax", re.I),
        "partial",
        "phone number",
    ),
    (
        re.compile(r"iban|credit_?card|card_?number|(^|_)cc_?num", re.I),
        "partial",
        "payment identifier",
    ),
    (
        re.compile(
            r"partita_?iva|(^|_)p_?iva($|_)|vat_?(number|id)|tax_?(id|code)", re.I
        ),
        "partial",
        "tax identifier",
    ),
    (re.compile(r"password|secret|token|api_?key", re.I), "full", "credential"),
    (re.compile(r"birth|nascita|(^|_)dob($|_)", re.I), "full", "birth date"),
    (
        re.compile(r"address|indirizzo|street|(^|_)via($|_)", re.I),
        "full",
        "postal address",
    ),
]

_LOCK = threading.RLock()


class PiiRulesStore:
    def __init__(self, db_path: Path | str | None = None) -> None:
        self._db_path = str(db_path or (data_dir() / "pii_rules.db"))
        self._init_tables()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA busy_timeout = 5000")
        return conn

    def _init_tables(self) -> None:
        with _LOCK, self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS pii_rules (
                    id         TEXT PRIMARY KEY,
                    "table"    TEXT NOT NULL DEFAULT '',
                    column     TEXT NOT NULL,
                    strategy   TEXT NOT NULL,
                    created_by TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL
                )
                """
            )

    def add(
        self, column: str, strategy: str, table: str = "", created_by: str = ""
    ) -> dict:
        """One rule per (table, column): re-adding replaces the strategy."""
        if strategy not in STRATEGIES:
            raise ValueError(f"strategy must be one of {STRATEGIES}")
        column = column.strip()
        table = table.strip()
        if not column:
            raise ValueError("column is required")
        record = {
            "id": uuid.uuid4().hex,
            "table": table,
            "column": column,
            "strategy": strategy,
            "created_by": created_by,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        with _LOCK, self._connect() as conn:
            conn.execute(
                'DELETE FROM pii_rules WHERE lower("table") = ? AND lower(column) = ?',
                (table.lower(), column.lower()),
            )
            conn.execute(
                'INSERT INTO pii_rules (id, "table", column, strategy,'
                " created_by, created_at) VALUES (?,?,?,?,?,?)",
                (
                    record["id"],
                    table,
                    column,
                    strategy,
                    created_by,
                    record["created_at"],
                ),
            )
        return record

    def list_rules(self) -> list[dict]:
        with _LOCK, self._connect() as conn:
            rows = conn.execute(
                'SELECT * FROM pii_rules ORDER BY "table", column'
            ).fetchall()
        return [dict(r) for r in rows]

    def delete(self, rule_id: str) -> bool:
        with _LOCK, self._connect() as conn:
            cur = conn.execute("DELETE FROM pii_rules WHERE id = ?", (rule_id,))
            return cur.rowcount > 0


# ── masking ───────────────────────────────────────────────────────────────────


def mask_value(value: Any, strategy: str) -> Any:
    """Mask a single value. None stays None (its absence is not sensitive)."""
    if value is None:
        return None
    text = str(value)
    if strategy == "partial":
        return f"{_MASK} {text[-4:]}" if len(text) > 4 else _MASK
    if strategy == "email" and "@" in text:
        local, _, domain = text.partition("@")
        return f"{local[:1]}•••@{domain}" if domain else _MASK
    return _MASK


def _applicable(rules: list[dict], tables: list[str] | None) -> dict[str, str]:
    """column(lower) → strategy for the given result context. Global rules
    (empty table) always apply; table-scoped rules apply when their table is
    among *tables* (None = unknown context → global rules only)."""
    table_set = {t.lower() for t in (tables or [])}
    out: dict[str, str] = {}
    for rule in rules:
        rule_table = str(rule.get("table", "")).lower()
        if rule_table and rule_table not in table_set:
            continue
        # Table-scoped rules override a global rule for the same column.
        col = str(rule.get("column", "")).lower()
        if rule_table or col not in out:
            out[col] = str(rule.get("strategy", "full"))
    return out


def mask_rows(
    rows: list[dict],
    rules: list[dict],
    tables: list[str] | None = None,
) -> tuple[list[dict], list[str]]:
    """Return (masked copy of *rows*, sorted masked column names).
    Matching is by output column name, case-insensitive — conservative by
    design: a protected column name is masked wherever it shows up."""
    if not rows or not rules:
        return rows, []
    by_column = _applicable(rules, tables)
    if not by_column:
        return rows, []
    masked_cols: set[str] = set()
    out: list[dict] = []
    for row in rows:
        new_row = dict(row)
        for key in row:
            strategy = by_column.get(str(key).lower())
            if strategy is not None:
                new_row[key] = mask_value(row[key], strategy)
                masked_cols.add(str(key))
        out.append(new_row)
    return out, sorted(masked_cols)


def suggest_rules(schema: dict[str, dict], existing: list[dict]) -> list[dict]:
    """Deterministic suggestions from column NAMES (no data is read).
    Columns already covered by a rule are skipped."""
    covered = {
        (str(r.get("table", "")).lower(), str(r.get("column", "")).lower())
        for r in existing
    }
    covered_global = {c for t, c in covered if not t}
    suggestions: list[dict] = []
    for table, info in schema.items():
        for col in info.get("columns") or []:
            name = str(col.get("name", ""))
            if not name:
                continue
            key = name.lower()
            if key in covered_global or (table.lower(), key) in covered:
                continue
            for pattern, strategy, reason in _SUGGESTION_PATTERNS:
                if pattern.search(name):
                    suggestions.append(
                        {
                            "table": table,
                            "column": name,
                            "strategy": strategy,
                            "reason": reason,
                        }
                    )
                    break
    return suggestions


_default_store: PiiRulesStore | None = None


def get_pii_store() -> PiiRulesStore:
    global _default_store  # noqa: PLW0603 — process-wide singleton by design
    if _default_store is None:
        _default_store = PiiRulesStore()
    return _default_store
