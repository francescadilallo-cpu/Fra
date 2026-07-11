"""Periodic workspace digest — the "passive value" layer on top of the agent
runtime.

Once per period (``FRA_DIGEST_INTERVAL``: ``daily`` default, ``weekly``, or
``off``) the digest aggregates what happened since the last one:

- server-side agent runs and their findings (from ``agent_runs``), with
  severity counts and the most important warning/critical texts;
- write actions still waiting for human approval (HITL queue);
- tables still marked "uncertain" by the curation layer.

The digest is persisted in a ``digests`` table (same SQLite as the agent
definitions, readable via API even if delivery fails) and delivered
best-effort to every enabled *webhook* notification channel. Slack/Teams/
email channels are skipped with a note — their transports are not
implemented on this deployment, and pretending otherwise would be worse.

Scheduling piggybacks on the AgentRuntime loop (``extra_tick``): no second
thread, and an idle digest costs one SQLite read per tick.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger(__name__)

_INTERVALS: dict[str, timedelta] = {
    "daily": timedelta(days=1),
    "weekly": timedelta(weeks=1),
}
_MAX_HIGHLIGHTS = 10
_SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2}


def _now() -> datetime:
    return datetime.now(timezone.utc)


class DigestService:
    """``get_extras()`` returns the non-runtime half of the digest
    (pending approvals, curation uncertain count) — injected so this module
    never imports main. ``deliver(digest)`` pushes to notification channels;
    failures are logged, never raised."""

    def __init__(
        self,
        db_path: Path | str,
        get_extras: Callable[[], dict[str, Any]] | None = None,
        deliver: Callable[[dict], None] | None = None,
    ) -> None:
        self._db_path = str(db_path)
        self._get_extras = get_extras or (lambda: {})
        self._deliver = deliver or (lambda digest: None)
        self._init_tables()

    # ── persistence ───────────────────────────────────────────────────────────

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA busy_timeout = 5000")
        return conn

    def _init_tables(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS digests (
                    id         TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    period_start TEXT NOT NULL,
                    payload    TEXT NOT NULL,
                    delivered  INTEGER NOT NULL DEFAULT 0
                )
                """
            )

    def latest(self) -> dict | None:
        rows = self.list(limit=1)
        return rows[0] if rows else None

    def list(self, limit: int = 10) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM digests ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {
                "id": r["id"],
                "created_at": r["created_at"],
                "period_start": r["period_start"],
                "delivered": bool(r["delivered"]),
                **json.loads(r["payload"] or "{}"),
            }
            for r in rows
        ]

    # ── scheduling ────────────────────────────────────────────────────────────

    @staticmethod
    def _interval() -> timedelta | None:
        raw = os.getenv("FRA_DIGEST_INTERVAL", "daily").strip().lower()
        if raw in ("off", "false", "0", "none", ""):
            return None
        return _INTERVALS.get(raw, _INTERVALS["daily"])

    def due(self) -> bool:
        interval = self._interval()
        if interval is None:
            return False
        last = self.latest()
        if last is None:
            return True
        try:
            return _now() - datetime.fromisoformat(last["created_at"]) >= interval
        except ValueError:
            return True

    def tick(self) -> None:
        """Called from the AgentRuntime loop. Runs at most one digest."""
        if self.due():
            self.run()

    # ── generation ────────────────────────────────────────────────────────────

    def run(self) -> dict:
        """Build, persist and (best-effort) deliver one digest now."""
        interval = self._interval() or _INTERVALS["daily"]
        last = self.latest()
        period_start = last["created_at"] if last else (_now() - interval).isoformat()

        agents = self._agent_activity(period_start)
        payload: dict[str, Any] = {
            "period_end": _now().isoformat(),
            **agents,
        }
        try:
            extras = self._get_extras()
            if isinstance(extras, dict):
                payload.update(extras)
        except Exception as exc:  # noqa: BLE001 — extras are best-effort
            logger.warning("digest extras failed: %s", exc)

        delivered = False
        try:
            self._deliver(payload)
            delivered = True
        except Exception as exc:  # noqa: BLE001 — delivery must not lose the digest
            logger.warning("digest delivery failed: %s", exc)

        record_id = uuid.uuid4().hex
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO digests (id, created_at, period_start, payload,"
                " delivered) VALUES (?, ?, ?, ?, ?)",
                (
                    record_id,
                    _now().isoformat(),
                    period_start,
                    json.dumps(payload, ensure_ascii=False),
                    1 if delivered else 0,
                ),
            )
        logger.info(
            "digest %s: %d runs, %d findings, delivered=%s",
            record_id,
            payload.get("agent_runs", 0),
            payload.get("findings_total", 0),
            delivered,
        )
        return {"id": record_id, "delivered": delivered, **payload}

    def _agent_activity(self, since: str) -> dict[str, Any]:
        """Aggregate server-side agent runs since *since* (live agents only —
        the runtime only writes live runs, so no extra filter is needed)."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT agent_id, status, findings FROM agent_runs "
                "WHERE started_at >= ? ORDER BY started_at DESC",
                (since,),
            ).fetchall()

        severity_counts = {"critical": 0, "warning": 0, "info": 0}
        highlights: list[dict] = []
        failed_runs = 0
        agent_names: dict[str, str] = {}
        with self._connect() as conn:
            for r in conn.execute("SELECT id, name FROM custom_agents").fetchall():
                agent_names[r["id"]] = r["name"]

        for row in rows:
            if row["status"] == "failed":
                failed_runs += 1
            try:
                findings = json.loads(row["findings"] or "[]")
            except json.JSONDecodeError:
                continue
            for f in findings:
                sev = str(f.get("severity", "info"))
                if sev in severity_counts:
                    severity_counts[sev] += 1
                if sev in ("critical", "warning"):
                    highlights.append(
                        {
                            "agent": agent_names.get(row["agent_id"], row["agent_id"]),
                            "severity": sev,
                            "text": str(f.get("text", ""))[:200],
                        }
                    )

        highlights.sort(key=lambda h: _SEVERITY_ORDER.get(h["severity"], 3))
        return {
            "agent_runs": len(rows),
            "failed_runs": failed_runs,
            "findings_total": sum(severity_counts.values()),
            "findings_by_severity": severity_counts,
            "highlights": highlights[:_MAX_HIGHLIGHTS],
        }
