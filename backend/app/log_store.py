"""In-memory log ring-buffer + GET /api/admin/logs backing store.

Every log record emitted through the standard ``logging`` hierarchy is also
pushed here so the admin API can serve recent entries without requiring SSH
or filesystem access.
"""

from __future__ import annotations

import logging
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Any

_BUFFER_SIZE = 1000
_buffer: deque[dict[str, Any]] = deque(maxlen=_BUFFER_SIZE)
_lock = threading.Lock()

# Numeric order for level filtering
_LEVEL_ORDER = {
    "DEBUG": 10,
    "INFO": 20,
    "WARNING": 30,
    "ERROR": 40,
    "CRITICAL": 50,
}


class BufferHandler(logging.Handler):
    """Pushes every log record into the in-memory ring-buffer."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            entry: dict[str, Any] = {
                "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(
                    timespec="milliseconds"
                ),
                "level": record.levelname,
                "logger": record.name,
                "msg": self.format(record),
            }
            if record.exc_info:
                import traceback

                entry["traceback"] = "".join(
                    traceback.format_exception(*record.exc_info)
                )
            with _lock:
                _buffer.append(entry)
        except Exception:
            self.handleError(record)


def get_recent_logs(
    n: int = 200,
    min_level: str = "INFO",
) -> list[dict[str, Any]]:
    """Return the last *n* entries at or above *min_level*."""
    threshold = _LEVEL_ORDER.get(min_level.upper(), 20)
    with _lock:
        entries = list(_buffer)
    filtered = [e for e in entries if _LEVEL_ORDER.get(e["level"], 0) >= threshold]
    return filtered[-n:]
