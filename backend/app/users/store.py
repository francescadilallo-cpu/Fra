"""Workspace member store — invited users persisted in SQLite."""

from __future__ import annotations

import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

UserRole = Literal["admin", "editor", "viewer"]
UserStatus = Literal["active", "pending"]

_VALID_ROLES: frozenset[str] = frozenset({"admin", "editor", "viewer"})


@dataclass
class WorkspaceMember:
    id: str
    username: str
    email: str
    role: str
    status: str
    created_at: str


class UsersStore:
    def __init__(self, db_path: Path | str = "data/users.db") -> None:
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
                CREATE TABLE IF NOT EXISTS members (
                    id          TEXT PRIMARY KEY,
                    username    TEXT NOT NULL,
                    email       TEXT NOT NULL UNIQUE,
                    role        TEXT NOT NULL DEFAULT 'editor',
                    status      TEXT NOT NULL DEFAULT 'pending',
                    created_at  TEXT NOT NULL
                )
                """
            )

    @staticmethod
    def _row_to_member(row: sqlite3.Row) -> WorkspaceMember:
        return WorkspaceMember(
            id=row["id"],
            username=row["username"],
            email=row["email"],
            role=row["role"],
            status=row["status"],
            created_at=row["created_at"],
        )

    def list_members(self) -> list[WorkspaceMember]:
        with self._lock, self._connect() as c:
            rows = c.execute(
                "SELECT * FROM members ORDER BY created_at DESC"
            ).fetchall()
            return [self._row_to_member(r) for r in rows]

    def add_member(
        self,
        email: str,
        role: str = "editor",
    ) -> WorkspaceMember:
        email = email.strip()[:200]
        username = email.split("@")[0][:120]
        safe_role = role if role in _VALID_ROLES else "editor"
        member = WorkspaceMember(
            id=str(uuid.uuid4()),
            username=username,
            email=email,
            role=safe_role,
            status="pending",
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        with self._lock, self._connect() as c:
            c.execute(
                "INSERT OR IGNORE INTO members (id, username, email, role, status, created_at)"
                " VALUES (?,?,?,?,?,?)",
                (
                    member.id,
                    member.username,
                    member.email,
                    member.role,
                    member.status,
                    member.created_at,
                ),
            )
        return member

    def update_role(self, member_id: str, role: str) -> bool:
        if role not in _VALID_ROLES:
            return False
        with self._lock, self._connect() as c:
            cur = c.execute("UPDATE members SET role=? WHERE id=?", (role, member_id))
            return cur.rowcount > 0

    def remove_member(self, member_id: str) -> bool:
        with self._lock, self._connect() as c:
            cur = c.execute("DELETE FROM members WHERE id=?", (member_id,))
            return cur.rowcount > 0


_store: UsersStore | None = None
_store_lock = threading.Lock()


def get_users_store() -> UsersStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = UsersStore()
    return _store
