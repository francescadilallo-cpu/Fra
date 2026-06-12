"""Notification channels + severity routing, persisted in SQLite."""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path

_VALID_TYPES: frozenset[str] = frozenset({"slack", "email", "teams", "webhook"})
_VALID_SEVERITIES: tuple[str, ...] = ("critical", "warning", "info")
_DEFAULT_DB = Path(__file__).parent.parent.parent / "data" / "notifications.db"


@dataclass
class Channel:
    id: str
    name: str
    channel_type: str
    destination: str
    enabled: bool


class NotificationsStore:
    def __init__(self, db_path: Path | str = _DEFAULT_DB) -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init()

    def _connect(self) -> sqlite3.Connection:
        c = sqlite3.connect(str(self._db_path))
        c.row_factory = sqlite3.Row
        return c

    def _init(self) -> None:
        with self._lock, self._connect() as c:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS channels (
                    id           TEXT PRIMARY KEY,
                    name         TEXT NOT NULL,
                    channel_type TEXT NOT NULL,
                    destination  TEXT NOT NULL,
                    enabled      INTEGER NOT NULL DEFAULT 1
                )
                """
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS routing (
                    severity    TEXT PRIMARY KEY,
                    channel_ids TEXT NOT NULL DEFAULT '[]'
                )
                """
            )

    @staticmethod
    def _row_to_channel(row: sqlite3.Row) -> Channel:
        return Channel(
            id=row["id"],
            name=row["name"],
            channel_type=row["channel_type"],
            destination=row["destination"],
            enabled=bool(row["enabled"]),
        )

    # ── channels ──────────────────────────────────────────────────────────────

    def list_channels(self) -> list[Channel]:
        with self._lock, self._connect() as c:
            rows = c.execute("SELECT * FROM channels ORDER BY rowid").fetchall()
            return [self._row_to_channel(r) for r in rows]

    def add_channel(self, name: str, channel_type: str, destination: str) -> Channel:
        safe_type = channel_type if channel_type in _VALID_TYPES else "webhook"
        ch = Channel(
            id=str(uuid.uuid4()),
            name=name[:100],
            channel_type=safe_type,
            destination=destination[:500],
            enabled=True,
        )
        with self._lock, self._connect() as c:
            c.execute(
                "INSERT INTO channels (id, name, channel_type, destination, enabled)"
                " VALUES (?,?,?,?,1)",
                (ch.id, ch.name, ch.channel_type, ch.destination),
            )
        return ch

    def update_channel(
        self,
        channel_id: str,
        *,
        enabled: bool | None = None,
        name: str | None = None,
    ) -> bool:
        clauses: list[str] = []
        params: list[object] = []
        if enabled is not None:
            clauses.append("enabled=?")
            params.append(int(enabled))
        if name is not None:
            clauses.append("name=?")
            params.append(name[:100])
        if not clauses:
            return True
        params.append(channel_id)
        with self._lock, self._connect() as c:
            cur = c.execute(
                f"UPDATE channels SET {', '.join(clauses)} WHERE id=?", params
            )
            return cur.rowcount > 0

    def remove_channel(self, channel_id: str) -> bool:
        with self._lock, self._connect() as c:
            cur = c.execute("DELETE FROM channels WHERE id=?", (channel_id,))
            return cur.rowcount > 0

    # ── routing ───────────────────────────────────────────────────────────────

    def get_routing(self) -> dict[str, list[str]]:
        result: dict[str, list[str]] = {s: [] for s in _VALID_SEVERITIES}
        with self._lock, self._connect() as c:
            for row in c.execute("SELECT severity, channel_ids FROM routing"):
                if row["severity"] in result:
                    result[row["severity"]] = json.loads(row["channel_ids"])
        return result

    def update_routing(self, routing: dict[str, list[str]]) -> None:
        with self._lock, self._connect() as c:
            for sev in _VALID_SEVERITIES:
                ids = json.dumps(routing.get(sev, []))
                c.execute(
                    "INSERT INTO routing (severity, channel_ids) VALUES (?,?)"
                    " ON CONFLICT(severity) DO UPDATE SET channel_ids=excluded.channel_ids",
                    (sev, ids),
                )


_store: NotificationsStore | None = None
_store_lock = threading.Lock()


def get_notifications_store() -> NotificationsStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = NotificationsStore()
    return _store
