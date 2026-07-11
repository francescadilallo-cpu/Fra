"""Verified answers — the learning loop for NL→SQL.

When a user confirms that an answer is correct, the (question, SQL) pair is
stored here. Future questions retrieve the most similar verified pairs and
inject them as few-shot examples into the LLM-SQL prompt, so the model
learns THIS workspace's phrasing and schema idioms from human approvals —
the same philosophy as the curation learning loop, applied to the query
engine.

Safety rails:

- Only SQL that passes the same SELECT-only guardrails as generated SQL is
  ever stored (the API endpoint validates before calling ``add``).
- Retrieval is mode-scoped (demo pairs never reach live prompts) and drops
  any example whose SQL references a table hidden from the caller — a demo
  table name must never leak into a live user's prompt.
- Matching is deterministic and lexical (token overlap), no LLM involved.
"""

from __future__ import annotations

import logging
import re
import sqlite3
import threading
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path

from ..paths import data_dir

logger = logging.getLogger(__name__)

_MAX_EXAMPLES = 3
_MIN_OVERLAP = 0.34  # at least ~1/3 of the stored question's tokens must match
_TOKEN_RE = re.compile(r"[^a-z0-9]+")
_STOPWORDS = frozenset(
    # EN + IT question scaffolding — keep only content-bearing tokens.
    "the a an of for in on at to by with and or is are was were what which "
    "who how many much show me list give all per il lo la i gli le di del "
    "della dei delle da in su per con e o è sono che chi come quanti quante "
    "quale quali mostra dammi elenca tutti tutte".split()
)


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def _tokens(text: str) -> frozenset[str]:
    return frozenset(
        t for t in _TOKEN_RE.split(_fold(text)) if len(t) > 1 and t not in _STOPWORDS
    )


_LOCK = threading.RLock()


class VerifiedAnswersStore:
    def __init__(self, db_path: Path | str | None = None) -> None:
        self._db_path = str(db_path or (data_dir() / "verified_answers.db"))
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
                CREATE TABLE IF NOT EXISTS verified_answers (
                    id           TEXT PRIMARY KEY,
                    mode         TEXT NOT NULL DEFAULT 'live',
                    question     TEXT NOT NULL,
                    sql          TEXT NOT NULL,
                    verified_by  TEXT NOT NULL DEFAULT '',
                    created_at   TEXT NOT NULL,
                    last_used_at TEXT,
                    use_count    INTEGER NOT NULL DEFAULT 0
                )
                """
            )

    # ── API ───────────────────────────────────────────────────────────────────

    def add(self, question: str, sql: str, verified_by: str, mode: str) -> dict:
        """Store a verified pair. An identical question (folded) in the same
        mode is replaced — the newest human confirmation wins."""
        question = question.strip()
        sql = sql.strip()
        record = {
            "id": uuid.uuid4().hex,
            "mode": mode,
            "question": question,
            "sql": sql,
            "verified_by": verified_by,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "last_used_at": None,
            "use_count": 0,
        }
        folded = _fold(question)
        with _LOCK, self._connect() as conn:
            existing = conn.execute(
                "SELECT id, question FROM verified_answers WHERE mode = ?", (mode,)
            ).fetchall()
            for row in existing:
                if _fold(row["question"]) == folded:
                    conn.execute(
                        "DELETE FROM verified_answers WHERE id = ?", (row["id"],)
                    )
            conn.execute(
                "INSERT INTO verified_answers (id, mode, question, sql,"
                " verified_by, created_at, use_count) VALUES (?,?,?,?,?,?,0)",
                (
                    record["id"],
                    mode,
                    question,
                    sql,
                    verified_by,
                    record["created_at"],
                ),
            )
        return record

    def list_answers(self, mode: str, limit: int = 200) -> list[dict]:
        with _LOCK, self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM verified_answers WHERE mode = ?"
                " ORDER BY created_at DESC LIMIT ?",
                (mode, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def delete(self, answer_id: str) -> bool:
        with _LOCK, self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM verified_answers WHERE id = ?", (answer_id,)
            )
            return cur.rowcount > 0

    # ── retrieval ─────────────────────────────────────────────────────────────

    def find_similar(
        self,
        question: str,
        mode: str,
        hidden_tables: frozenset[str] = frozenset(),
        limit: int = _MAX_EXAMPLES,
    ) -> list[dict]:
        """Top verified pairs lexically similar to *question*, mode-scoped.
        Pairs whose SQL references a hidden table are dropped — their table
        names must not leak into the caller's prompt."""
        asked = _tokens(question)
        if not asked:
            return []
        hidden_folded = {_fold(t) for t in hidden_tables}
        scored: list[tuple[float, dict]] = []
        for row in self.list_answers(mode, limit=500):
            sql_folded = _fold(row["sql"])
            if any(h and h in sql_folded for h in hidden_folded):
                continue
            stored = _tokens(row["question"])
            if not stored:
                continue
            overlap = len(asked & stored) / len(stored)
            if overlap >= _MIN_OVERLAP:
                scored.append((overlap, row))
        scored.sort(key=lambda pair: (-pair[0], pair[1]["created_at"]))
        return [row for _, row in scored[:limit]]

    def mark_used(self, answer_ids: list[str]) -> None:
        """Best-effort usage bookkeeping for the management UI."""
        if not answer_ids:
            return
        try:
            now = datetime.now(timezone.utc).isoformat()
            with _LOCK, self._connect() as conn:
                for aid in answer_ids:
                    conn.execute(
                        "UPDATE verified_answers SET use_count = use_count + 1,"
                        " last_used_at = ? WHERE id = ?",
                        (now, aid),
                    )
        except sqlite3.Error as exc:
            logger.debug("verified answers usage update failed: %s", exc)


def few_shot_block(
    store: "VerifiedAnswersStore",
    question: str,
    mode: str,
    hidden_tables: frozenset[str] = frozenset(),
) -> str:
    """Prompt block with the most similar verified pairs, or '' when none.
    Marks returned examples as used (best-effort)."""
    try:
        matches = store.find_similar(question, mode, hidden_tables)
    except Exception as exc:  # noqa: BLE001 — retrieval must never break a query
        logger.warning("verified answers retrieval failed: %s", exc)
        return ""
    if not matches:
        return ""
    store.mark_used([m["id"] for m in matches])
    lines = [
        "\n\n### Verified examples",
        "Question→SQL pairs previously confirmed correct by this workspace's "
        "users. Follow their table/column choices and phrasing conventions "
        "when applicable:",
    ]
    for m in matches:
        lines.append(f"Q: {m['question']}\nSQL: {m['sql']}")
    return "\n".join(lines)


_default_store: VerifiedAnswersStore | None = None


def get_verified_answers_store() -> VerifiedAnswersStore:
    global _default_store  # noqa: PLW0603 — process-wide singleton by design
    if _default_store is None:
        _default_store = VerifiedAnswersStore()
    return _default_store
