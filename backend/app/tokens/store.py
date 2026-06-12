"""API token store — generated tokens persisted as SHA-256 hashes."""

from __future__ import annotations

import hashlib
import secrets
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

_TOKEN_PREFIX = "si_"
_TOKEN_BYTES = 32  # 256 bits of entropy → 43 base64url chars after prefix
_DEFAULT_TTL_DAYS = 90
_DEFAULT_DB = Path(__file__).parent.parent.parent / "data" / "tokens.db"


@dataclass
class ApiTokenRecord:
    id: str
    name: str
    scopes: list[str]
    token_preview: str  # e.g. "si_abc12345••••••xyz9"
    created_at: str
    expires_at: str
    last_used_at: str | None
    revoked: bool


class TokensStore:
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
                CREATE TABLE IF NOT EXISTS tokens (
                    id           TEXT PRIMARY KEY,
                    name         TEXT NOT NULL,
                    scopes       TEXT NOT NULL DEFAULT '[]',
                    token_hash   TEXT NOT NULL UNIQUE,
                    token_prefix TEXT NOT NULL,
                    token_suffix TEXT NOT NULL,
                    created_at   TEXT NOT NULL,
                    expires_at   TEXT NOT NULL,
                    last_used_at TEXT,
                    revoked      INTEGER NOT NULL DEFAULT 0
                )
                """
            )

    @staticmethod
    def _row_to_record(row: sqlite3.Row) -> ApiTokenRecord:
        import json

        preview = f"{row['token_prefix']}••••••{row['token_suffix']}"
        return ApiTokenRecord(
            id=row["id"],
            name=row["name"],
            scopes=json.loads(row["scopes"]),
            token_preview=preview,
            created_at=row["created_at"],
            expires_at=row["expires_at"],
            last_used_at=row["last_used_at"],
            revoked=bool(row["revoked"]),
        )

    def generate(
        self, name: str, scopes: list[str], ttl_days: int = _DEFAULT_TTL_DAYS
    ) -> tuple[ApiTokenRecord, str]:
        """Create a token. Returns (record, plaintext_token). Plaintext is never stored."""
        import json
        import uuid

        raw = secrets.token_urlsafe(_TOKEN_BYTES)
        plaintext = f"{_TOKEN_PREFIX}{raw}"
        token_hash = hashlib.sha256(plaintext.encode()).hexdigest()
        prefix = plaintext[:12]
        suffix = plaintext[-4:]
        now = datetime.now(timezone.utc)
        expires = now + timedelta(days=ttl_days)
        record_id = str(uuid.uuid4())
        safe_name = name[:100]
        safe_scopes = json.dumps([s for s in scopes if isinstance(s, str)])
        preview = f"{prefix}••••••{suffix}"

        with self._lock, self._connect() as c:
            c.execute(
                "INSERT INTO tokens (id, name, scopes, token_hash, token_prefix, token_suffix,"
                " created_at, expires_at, revoked) VALUES (?,?,?,?,?,?,?,?,0)",
                (
                    record_id,
                    safe_name,
                    safe_scopes,
                    token_hash,
                    prefix,
                    suffix,
                    now.isoformat(),
                    expires.isoformat(),
                ),
            )

        record = ApiTokenRecord(
            id=record_id,
            name=safe_name,
            scopes=json.loads(safe_scopes),
            token_preview=preview,
            created_at=now.isoformat(),
            expires_at=expires.isoformat(),
            last_used_at=None,
            revoked=False,
        )
        return record, plaintext

    def list_tokens(self) -> list[ApiTokenRecord]:
        with self._lock, self._connect() as c:
            rows = c.execute(
                "SELECT * FROM tokens WHERE revoked=0 ORDER BY created_at DESC"
            ).fetchall()
            return [self._row_to_record(r) for r in rows]

    def revoke(self, token_id: str) -> bool:
        with self._lock, self._connect() as c:
            cur = c.execute(
                "UPDATE tokens SET revoked=1 WHERE id=? AND revoked=0", (token_id,)
            )
            return cur.rowcount > 0

    def touch(self, token_hash: str) -> None:
        """Update last_used_at when a token is used for authentication."""
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connect() as c:
            c.execute(
                "UPDATE tokens SET last_used_at=? WHERE token_hash=?", (now, token_hash)
            )

    def verify(self, plaintext: str) -> ApiTokenRecord | None:
        """Return the record if the token is valid (not revoked, not expired)."""

        token_hash = hashlib.sha256(plaintext.encode()).hexdigest()
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connect() as c:
            row = c.execute(
                "SELECT * FROM tokens WHERE token_hash=? AND revoked=0 AND expires_at > ?",
                (token_hash, now),
            ).fetchone()
        if row is None:
            return None
        return self._row_to_record(row)


_store: TokensStore | None = None
_store_lock = threading.Lock()


def get_tokens_store() -> TokensStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = TokensStore()
    return _store
