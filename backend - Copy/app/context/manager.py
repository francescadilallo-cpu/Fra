"""ContextManager — in-process, thread-safe session store.

Maintains per-session intent history and resolved entity aliases,
so that a user who resolved "fatturato" to "revenue_with_tax" in Q21 will
have that resolution remembered for subsequent questions.
"""
from __future__ import annotations

import logging
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

_MAX_HISTORY = 20  # keep last N intents per session


@dataclass
class Context:
    """Per-session context state."""

    session_id: str
    user: str = "default"
    role: str = "viewer"
    history: list[Any] = field(default_factory=list)          # list[Intent]
    resolved_entities: dict[str, str] = field(default_factory=dict)
    # e.g. {"fatturato": "revenue_with_tax"}

    def add_history(self, intent: Any, result: Any) -> None:
        """Append (intent, result) pair; trim to _MAX_HISTORY."""
        self.history.append({"intent": intent, "result": result})
        if len(self.history) > _MAX_HISTORY:
            self.history = self.history[-_MAX_HISTORY:]


class ContextManager:
    """Thread-safe in-process context store."""

    def __init__(self) -> None:
        self._store: dict[str, Context] = {}
        self._lock = threading.Lock()

    def get_or_create(self, session_id: str | None = None, user: str = "default") -> Context:
        """Return existing context or create a new one."""
        if session_id is None:
            session_id = str(uuid.uuid4())
        with self._lock:
            if session_id not in self._store:
                ctx = Context(session_id=session_id, user=user)
                self._store[session_id] = ctx
                logger.debug("Created new context for session %s", session_id)
            return self._store[session_id]

    def update(self, session_id: str, intent: Any, result: Any) -> None:
        """Record intent + result into the session history."""
        with self._lock:
            ctx = self._store.get(session_id)
            if ctx:
                ctx.add_history(intent, result)

    def resolve(self, session_id: str, term: str) -> str | None:
        """Look up a previously resolved entity alias.

        Returns the canonical term if the session has resolved *term* before,
        or None if unknown.
        """
        with self._lock:
            ctx = self._store.get(session_id)
            if ctx:
                return ctx.resolved_entities.get(term)
        return None

    def remember(self, session_id: str, term: str, resolution: str) -> None:
        """Store a disambiguation resolution into the session."""
        with self._lock:
            ctx = self._store.get(session_id)
            if ctx:
                ctx.resolved_entities[term] = resolution
                logger.debug(
                    "Session %s: resolved '%s' → '%s'", session_id, term, resolution
                )

    def list_sessions(self) -> list[str]:
        with self._lock:
            return list(self._store.keys())

    def drop_session(self, session_id: str) -> bool:
        with self._lock:
            if session_id in self._store:
                del self._store[session_id]
                return True
        return False
