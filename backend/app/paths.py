"""Single source of truth for the mutable-data directory.

Every durable store (source registry, Salesforce tokens, users/workspace/audit/
notifications SQLite DBs, the unified DuckDB) lives under one directory. On an
ephemeral host (e.g. Render's free tier, where the container filesystem is wiped
on deploy/idle-spindown/OOM-restart) that state vanishes across restarts.

Set ``FRA_DATA_DIR`` to a path on a *persistent* volume to keep it across
restarts; it defaults to ``backend/data`` so local runs are unchanged.
"""

from __future__ import annotations

import os
from pathlib import Path

# .../backend (this file is at .../backend/app/paths.py)
_BACKEND_ROOT = Path(__file__).resolve().parent.parent


def data_dir() -> Path:
    """Return the mutable-data directory, creating it if needed.

    Honors ``FRA_DATA_DIR`` (point it at a persistent volume in production);
    falls back to ``backend/data``.
    """
    raw = os.getenv("FRA_DATA_DIR", "").strip()
    base = Path(raw) if raw else _BACKEND_ROOT / "data"
    base.mkdir(parents=True, exist_ok=True)
    return base
