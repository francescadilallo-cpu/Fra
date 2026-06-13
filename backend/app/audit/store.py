"""Append-only audit trail — admin and API actions, persisted to SQLite.

The audit log is write-once by design: there is no update or delete API.
Entries record who did what, on which resource, from which IP, so live
workspaces can satisfy traceability requirements (EU AI Act Art. 12).
"""

from __future__ import annotations

import logging
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).parent.parent.parent / "data" / "audit.db"

VALID_CATEGORIES = {"auth", "config", "data", "reports"}


@dataclass
class AuditEntry:
    id: int
    ts: str
    username: str
    action: str
    resource: str
    ip: str
    category: str


class AuditStore:
    def __init__(self, db_path: Path = DB_PATH) -> None:
        self._db = db_path
        self._db.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute("PRAGMA busy_timeout = 5000")
        return conn

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS audit_entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts TEXT NOT NULL,
                    username TEXT NOT NULL,
                    action TEXT NOT NULL,
                    resource TEXT NOT NULL DEFAULT '',
                    ip TEXT NOT NULL DEFAULT '',
                    category TEXT NOT NULL DEFAULT 'config'
                );
                CREATE INDEX IF NOT EXISTS idx_audit_ts
                    ON audit_entries (ts DESC);
                CREATE INDEX IF NOT EXISTS idx_audit_category
                    ON audit_entries (category, id DESC);
            """)

    def log(
        self,
        username: str,
        action: str,
        resource: str = "",
        ip: str = "",
        category: str = "config",
    ) -> None:
        """Append an entry. Never raises — auditing must not break the action."""
        if category not in VALID_CATEGORIES:
            category = "config"
        try:
            with self._conn() as conn:
                conn.execute(
                    "INSERT INTO audit_entries (ts, username, action, resource, ip, category)"
                    " VALUES (?,?,?,?,?,?)",
                    (
                        datetime.now(timezone.utc).isoformat(),
                        username[:120],
                        action[:200],
                        resource[:300],
                        ip[:64],
                        category,
                    ),
                )
        except Exception as exc:
            logger.warning("Audit log write failed: %s", exc)

    def list(
        self,
        limit: int = 200,
        category: str | None = None,
        q: str | None = None,
    ) -> list[AuditEntry]:
        limit = max(1, min(limit, 1000))
        clauses: list[str] = []
        params: list[object] = []
        if category and category in VALID_CATEGORIES:
            clauses.append("category = ?")
            params.append(category)
        if q:
            like = f"%{q.lower()}%"
            clauses.append(
                "(LOWER(username) LIKE ? OR LOWER(action) LIKE ? OR LOWER(resource) LIKE ?)"
            )
            params.extend([like, like, like])
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)
        with self._conn() as conn:
            rows = conn.execute(
                f"SELECT * FROM audit_entries {where} ORDER BY id DESC LIMIT ?",  # noqa: S608
                params,
            ).fetchall()
        return [AuditEntry(**dict(r)) for r in rows]


_STORE: AuditStore | None = None
_STORE_LOCK = threading.Lock()


def get_audit_store() -> AuditStore:
    global _STORE
    if _STORE is None:
        with _STORE_LOCK:
            if _STORE is None:
                _STORE = AuditStore()
    return _STORE
