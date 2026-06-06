"""AgentStateStore — persistence for executive-agent state.

Backs the executive agentic layer's *pending action queue* and *audit log*.

Two modes:
- **File-backed** (production): a SQLite file under backend/data/. Survives
  process restarts and is shared across worker processes via WAL journaling,
  so an action submitted on one worker can be approved on another.
- **In-memory** (default / tests): an isolated ``:memory:`` database held on a
  single connection for the lifetime of the store instance. Gives the same
  observable behaviour as the old in-process dict without leaking state
  between instances.

The store is the single source of truth; the layer holds no action state of
its own. The durable audit trail also continues to be emitted to the
application logs by the layer.
"""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

from .executive import AgentAuditRecord, PendingAgentAction

# Retain at most this many audit records (ring-buffer semantics). The full
# trail lives in the application logs; this bounds both memory and disk.
_DEFAULT_MAX_AUDIT = 2000


class AgentStateStore:
    """Thread-safe SQLite-backed store for pending actions and audit records."""

    def __init__(
        self, db_path: Path | None = None, max_audit: int = _DEFAULT_MAX_AUDIT
    ) -> None:
        self._memory = db_path is None
        self._db_path = Path(db_path) if db_path is not None else None
        self._max_audit = max_audit
        self._lock = threading.RLock()
        if self._memory:
            # One persistent connection so the in-memory DB survives between
            # operations (a fresh ``:memory:`` connect would be empty).
            self._mem_conn: sqlite3.Connection | None = sqlite3.connect(
                ":memory:", check_same_thread=False
            )
            self._mem_conn.row_factory = sqlite3.Row
        else:
            self._db_path.parent.mkdir(parents=True, exist_ok=True)  # type: ignore[union-attr]
            self._mem_conn = None
        self._init_db()

    # ── connection management ───────────────────────────────────────────────────

    def _open(self) -> sqlite3.Connection:
        if self._memory:
            assert self._mem_conn is not None
            return self._mem_conn
        conn = sqlite3.connect(str(self._db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute("PRAGMA busy_timeout = 5000")
        return conn

    def _close(self, conn: sqlite3.Connection) -> None:
        # The shared in-memory connection must never be closed.
        if not self._memory:
            conn.close()

    def _init_db(self) -> None:
        with self._lock:
            conn = self._open()
            try:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS pending_actions (
                        action_id   TEXT PRIMARY KEY,
                        status      TEXT NOT NULL,
                        payload_json TEXT NOT NULL,
                        created_at  TEXT NOT NULL,
                        updated_at  TEXT NOT NULL
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS audit_log (
                        seq         INTEGER PRIMARY KEY AUTOINCREMENT,
                        record_json TEXT NOT NULL
                    )
                    """
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_pending_status "
                    "ON pending_actions(status)"
                )
                conn.commit()
            finally:
                self._close(conn)

    # ── pending actions ─────────────────────────────────────────────────────────

    def save_action(self, action: PendingAgentAction) -> None:
        """Insert or update a pending action, preserving insertion order."""
        with self._lock:
            conn = self._open()
            try:
                conn.execute(
                    """
                    INSERT INTO pending_actions
                        (action_id, status, payload_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(action_id) DO UPDATE SET
                        status = excluded.status,
                        payload_json = excluded.payload_json,
                        updated_at = excluded.updated_at
                    """,
                    (
                        action.action_id,
                        action.status,
                        action.model_dump_json(),
                        action.created_at,
                        action.updated_at,
                    ),
                )
                conn.commit()
            finally:
                self._close(conn)

    def claim_pending_action(
        self, action_id: str, claimed_status: str, updated_at: str
    ) -> "PendingAgentAction | None":
        """Atomically claim a PENDING_HUMAN_APPROVAL action for processing.

        Transitions status from PENDING_HUMAN_APPROVAL to *claimed_status* via
        a single ``UPDATE ... WHERE status = 'PENDING_HUMAN_APPROVAL'`` that
        SQLite serialises at the file/WAL level — the database-level
        compare-and-swap that plain get_action()+save_action() cannot offer.

        Returns the claimed action (already reflecting *claimed_status*) iff
        *this* call performed the transition, i.e. ``cursor.rowcount == 1``.
        Returns None when the action doesn't exist OR another caller (same
        process or a different worker sharing this file-backed store) already
        transitioned it first — the caller must not execute the writeback.

        The in-process RLock in ExecutiveAgenticLayer still prevents the
        wasted DB round-trip on same-process concurrent calls; this method
        provides the *cross-process* guarantee those locks can't.
        """
        with self._lock:
            conn = self._open()
            try:
                row = conn.execute(
                    "SELECT payload_json FROM pending_actions WHERE action_id = ?",
                    (action_id,),
                ).fetchone()
                if row is None:
                    return None
                action = PendingAgentAction.model_validate_json(row["payload_json"])
                action.status = claimed_status
                action.updated_at = updated_at
                cursor = conn.execute(
                    """
                    UPDATE pending_actions
                       SET status = ?, payload_json = ?, updated_at = ?
                     WHERE action_id = ? AND status = 'PENDING_HUMAN_APPROVAL'
                    """,
                    (claimed_status, action.model_dump_json(), updated_at, action_id),
                )
                conn.commit()
                return action if cursor.rowcount == 1 else None
            finally:
                self._close(conn)

    def get_action(self, action_id: str) -> PendingAgentAction | None:
        with self._lock:
            conn = self._open()
            try:
                row = conn.execute(
                    "SELECT payload_json FROM pending_actions WHERE action_id = ?",
                    (action_id,),
                ).fetchone()
            finally:
                self._close(conn)
        if row is None:
            return None
        return PendingAgentAction.model_validate_json(row["payload_json"])

    def list_actions(
        self, status_filter: str | None = None, limit: int = 50
    ) -> list[PendingAgentAction]:
        """Return up to *limit* most-recent actions (chronological order)."""
        with self._lock:
            conn = self._open()
            try:
                if status_filter:
                    rows = conn.execute(
                        "SELECT payload_json FROM pending_actions "
                        "WHERE status = ? ORDER BY rowid DESC LIMIT ?",
                        (status_filter, limit),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT payload_json FROM pending_actions "
                        "ORDER BY rowid DESC LIMIT ?",
                        (limit,),
                    ).fetchall()
            finally:
                self._close(conn)
        actions = [
            PendingAgentAction.model_validate_json(r["payload_json"]) for r in rows
        ]
        actions.reverse()  # back to chronological order
        return actions

    # ── audit log ───────────────────────────────────────────────────────────────

    def append_audit(self, record: AgentAuditRecord) -> None:
        with self._lock:
            conn = self._open()
            try:
                conn.execute(
                    "INSERT INTO audit_log (record_json) VALUES (?)",
                    (record.model_dump_json(),),
                )
                # Ring-buffer prune: keep only the newest _max_audit rows.
                conn.execute(
                    "DELETE FROM audit_log WHERE seq <= "
                    "(SELECT MAX(seq) - ? FROM audit_log)",
                    (self._max_audit,),
                )
                conn.commit()
            finally:
                self._close(conn)

    def get_audit(self, limit: int = 200) -> list[AgentAuditRecord]:
        with self._lock:
            conn = self._open()
            try:
                rows = conn.execute(
                    "SELECT record_json FROM audit_log ORDER BY seq DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            finally:
                self._close(conn)
        records = [AgentAuditRecord.model_validate_json(r["record_json"]) for r in rows]
        records.reverse()  # chronological order
        return records

    def audit_count(self) -> int:
        with self._lock:
            conn = self._open()
            try:
                return conn.execute("SELECT COUNT(*) FROM audit_log").fetchone()[0]
            finally:
                self._close(conn)
