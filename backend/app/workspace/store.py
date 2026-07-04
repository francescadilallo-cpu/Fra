"""Workspace settings — company name and sector persisted in SQLite."""

from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from ..paths import data_dir

_DEFAULT_DB = data_dir() / "workspace.db"
_VALID_SECTORS = frozenset({"manufacturing", "retail", "healthcare", "finance"})


class WorkspaceStore:
    def __init__(self, db_path: Path | str = _DEFAULT_DB) -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init()

    def _connect(self) -> sqlite3.Connection:
        c = sqlite3.connect(str(self._db_path))
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode = WAL")
        c.execute("PRAGMA synchronous = NORMAL")
        c.execute("PRAGMA busy_timeout = 5000")
        return c

    def _init(self) -> None:
        with self._lock, self._connect() as c:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS workspace (
                    key        TEXT PRIMARY KEY,
                    value      TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

    def _get(self, key: str) -> str | None:
        with self._lock, self._connect() as c:
            row = c.execute(
                "SELECT value FROM workspace WHERE key=?", (key,)
            ).fetchone()
            return row["value"] if row else None

    def _set(self, key: str, value: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connect() as c:
            c.execute(
                "INSERT INTO workspace (key, value, updated_at) VALUES (?,?,?)"
                " ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                (key, value, now),
            )

    def get_name(self) -> str | None:
        return self._get("name")

    def get_sector(self) -> str | None:
        return self._get("sector_id")

    def update(self, name: str | None, sector_id: str | None) -> None:
        if name is not None:
            self._set("name", name[:200])
        if sector_id is not None and sector_id in _VALID_SECTORS:
            self._set("sector_id", sector_id)


_store: WorkspaceStore | None = None
_store_lock = threading.Lock()


def get_workspace_store() -> WorkspaceStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = WorkspaceStore()
    return _store
