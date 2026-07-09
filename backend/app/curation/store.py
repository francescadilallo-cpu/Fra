"""CurationStore — durable, reversible per-table curation decisions.

A decision never deletes anything: an "excluded" table stays in DuckDB and in
the connector; it is only hidden from the semantic surface (KG, draft, Entity
Graph, LLM schema context). Flipping it back to "kept" restores it fully.

Decisions carry provenance (``decided_by``): ``rule`` / ``signal`` decisions
are recomputed on every curation run, while ``user`` decisions are pinned —
the engine never overwrites a human choice.
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from ..paths import data_dir

logger = logging.getLogger(__name__)

DecisionStatus = Literal["kept", "excluded", "uncertain"]
DecidedBy = Literal["rule", "signal", "llm", "user"]

# Pin strength: engine tiers (rule/signal) freely overwrite each other on every
# run; an LLM verdict survives engine re-runs; a human decision beats all.
_PIN_RANK: dict[str, int] = {"rule": 0, "signal": 0, "llm": 1, "user": 2}

_LOCK = threading.RLock()


class CurationStore:
    """JSON-file-backed decision store (small: one record per table)."""

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or (data_dir() / "curation_decisions.json")

    # ── persistence ───────────────────────────────────────────────────────────

    def _load(self) -> dict[str, dict]:
        try:
            return json.loads(self._path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except Exception as exc:  # noqa: BLE001 — corrupted file must not brick boot
            logger.warning("curation store unreadable (%s) — starting empty", exc)
            return {}

    def _save(self, decisions: dict[str, dict]) -> None:
        tmp = self._path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(decisions, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        tmp.replace(self._path)

    # ── API ───────────────────────────────────────────────────────────────────

    def all_decisions(self) -> dict[str, dict]:
        with _LOCK:
            return self._load()

    def excluded_tables(self) -> frozenset[str]:
        with _LOCK:
            return frozenset(
                t for t, d in self._load().items() if d.get("status") == "excluded"
            )

    def set_decision(
        self,
        table: str,
        status: DecisionStatus,
        reason: str,
        decided_by: DecidedBy,
    ) -> dict:
        """Record a decision, honouring pin strength (user > llm > engine):
        a weaker source never overwrites a stronger one's decision."""
        with _LOCK:
            decisions = self._load()
            existing = decisions.get(table)
            if existing is not None and _PIN_RANK.get(
                str(existing.get("decided_by")), 0
            ) > _PIN_RANK.get(decided_by, 0):
                return existing
            record = {
                "status": status,
                "reason": reason,
                "decided_by": decided_by,
                "decided_at": datetime.now(timezone.utc).isoformat(),
            }
            decisions[table] = record
            self._save(decisions)
            return record

    def forget(self, table: str) -> bool:
        """Drop a decision entirely (the next run re-evaluates the table)."""
        with _LOCK:
            decisions = self._load()
            if table not in decisions:
                return False
            del decisions[table]
            self._save(decisions)
            return True


_default_store: CurationStore | None = None


def get_curation_store() -> CurationStore:
    global _default_store  # noqa: PLW0603 — process-wide singleton by design
    if _default_store is None:
        _default_store = CurationStore()
    return _default_store
