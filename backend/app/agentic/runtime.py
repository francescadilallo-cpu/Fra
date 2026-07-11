"""Server-side custom-agent runtime.

Until now scheduled custom agents only "ran" as a browser simulation
(setInterval in AgentsView) — nothing executed with the tab closed and no
run ever touched real data. This module is the real runtime:

- A daemon thread ticks every ``tick_seconds`` and looks for LIVE agents
  (sector_id ``live-*``) whose schedule is due. Demo agents stay
  browser-simulated by design — they exist to look alive in the demo.
- A due agent runs REAL, read-only checks against the unified DuckDB store:
  row counts and deltas vs the previous run, empty-entity warnings, and (for
  ``validator`` agents) per-column null rates. No LLM, no writes to customer
  data — deterministic and cheap by construction.
- Results are persisted in an ``agent_runs`` table next to the agent
  definitions, mirrored into the agent's ``findings`` (so the UI shows real
  outcomes), and warning/critical findings land in the audit log.
- Agents that would *change* data still go through the Executive Agentic
  Layer's human-approval queue — the runtime never writes back.

The heavy semantic context (source manager + entities) is resolved lazily
via an injected callable, only when at least one agent is actually due, so
an idle runtime costs one SQLite query per tick.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger(__name__)

_INTERVAL_SECONDS: dict[str, int] = {
    "5min": 300,
    "hourly": 3600,
    "daily": 86400,
    "weekly": 604800,
}

_MAX_ENTITIES_PER_AGENT = 20
_MAX_NULL_CHECK_COLUMNS = 10
_MAX_FINDINGS = 30


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _quote_ident(name: str) -> str:
    """DuckDB identifier quoting — table/column names come from the catalog,
    but quote them anyway so a weird name can't break out of the identifier."""
    return '"' + name.replace('"', '""') + '"'


class AgentRuntime:
    """Executes custom agents server-side.

    ``get_context()`` must return ``(manager, entities)`` where *manager*
    exposes ``execute(sql) -> list[tuple]`` and ``get_schema_info()``, and
    *entities* is the draft entity list (dicts with name/display_name/table).
    ``audit(action, resource)`` is a fire-and-forget hook for the audit log.
    """

    def __init__(
        self,
        db_path: Path | str,
        get_context: Callable[[], tuple[Any, list[dict]]],
        audit: Callable[[str, str], None] | None = None,
        tick_seconds: int = 60,
        extra_tick: Callable[[], None] | None = None,
    ) -> None:
        self._db_path = str(db_path)
        self._get_context = get_context
        self._audit = audit or (lambda action, resource: None)
        self._tick_seconds = tick_seconds
        # Piggyback hook for other periodic work (the workspace digest) so
        # one thread serves every scheduled concern.
        self._extra_tick = extra_tick
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._run_lock = threading.Lock()
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
                CREATE TABLE IF NOT EXISTS agent_runs (
                    id           TEXT PRIMARY KEY,
                    agent_id     TEXT NOT NULL,
                    sector_id    TEXT NOT NULL,
                    started_at   TEXT NOT NULL,
                    finished_at  TEXT,
                    status       TEXT NOT NULL DEFAULT 'running',
                    triggered_by TEXT NOT NULL DEFAULT 'schedule',
                    findings     TEXT NOT NULL DEFAULT '[]',
                    stats        TEXT NOT NULL DEFAULT '{}'
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_agent_runs_agent "
                "ON agent_runs (agent_id, started_at DESC)"
            )

    def list_runs(self, agent_id: str, limit: int = 20) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM agent_runs WHERE agent_id = ? "
                "ORDER BY started_at DESC LIMIT ?",
                (agent_id, limit),
            ).fetchall()
        return [self._row_to_run(r) for r in rows]

    @staticmethod
    def _row_to_run(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "agent_id": row["agent_id"],
            "sector_id": row["sector_id"],
            "started_at": row["started_at"],
            "finished_at": row["finished_at"],
            "status": row["status"],
            "triggered_by": row["triggered_by"],
            "findings": json.loads(row["findings"] or "[]"),
            "stats": json.loads(row["stats"] or "{}"),
        }

    def _last_run(self, agent_id: str) -> dict | None:
        runs = self.list_runs(agent_id, limit=1)
        return runs[0] if runs else None

    # ── scheduling ────────────────────────────────────────────────────────────

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._loop, name="agent-runtime", daemon=True
        )
        self._thread.start()
        logger.info("agent runtime started (tick=%ss)", self._tick_seconds)

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.wait(self._tick_seconds):
            try:
                self.tick()
            except Exception:  # noqa: BLE001 — the loop must survive anything
                logger.warning("agent runtime tick failed", exc_info=True)
            if self._extra_tick is not None:
                try:
                    self._extra_tick()
                except Exception:  # noqa: BLE001 — same survival guarantee
                    logger.warning("agent runtime extra tick failed", exc_info=True)

    def _due_agents(self) -> list[dict]:
        """LIVE agents with a schedule trigger whose interval has elapsed
        since their last server-side run."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, sector_id, name, template, entities, trigger "
                "FROM custom_agents WHERE sector_id LIKE 'live-%'"
            ).fetchall()
        due: list[dict] = []
        now = datetime.now(timezone.utc)
        for row in rows:
            try:
                trigger = json.loads(row["trigger"] or "{}")
            except json.JSONDecodeError:
                continue
            if trigger.get("kind") != "schedule":
                continue
            seconds = _INTERVAL_SECONDS.get(str(trigger.get("interval", "")))
            if seconds is None:
                continue
            last = self._last_run(row["id"])
            if last is not None:
                try:
                    last_at = datetime.fromisoformat(last["started_at"])
                    if (now - last_at).total_seconds() < seconds:
                        continue
                except ValueError:
                    pass
            due.append(
                {
                    "id": row["id"],
                    "sector_id": row["sector_id"],
                    "name": row["name"],
                    "template": row["template"],
                    "entities": json.loads(row["entities"] or "[]"),
                }
            )
        return due

    def tick(self) -> int:
        """One scheduler pass. Returns how many agents were run."""
        due = self._due_agents()
        for agent in due:
            try:
                self.run_agent(agent, triggered_by="schedule")
            except Exception:  # noqa: BLE001 — one bad agent must not stop the rest
                logger.warning("agent %s run failed", agent["id"], exc_info=True)
        return len(due)

    # ── execution ─────────────────────────────────────────────────────────────

    def run_agent(self, agent: dict, triggered_by: str = "manual") -> dict:
        """Run one agent's checks against real data (read-only) and persist
        the outcome. ``agent`` needs id/sector_id/name/template/entities."""
        with self._run_lock:  # one execution at a time keeps DuckDB happy
            run_id = uuid.uuid4().hex
            started = _now()
            # Capture the previous run BEFORE inserting this one — deltas
            # compare against the last completed run, not against ourselves.
            previous = self._last_run(agent["id"])
            prev_counts: dict[str, int] = (
                (previous or {}).get("stats", {}).get("row_counts", {})
            )
            with self._connect() as conn:
                conn.execute(
                    "INSERT INTO agent_runs (id, agent_id, sector_id, started_at,"
                    " status, triggered_by) VALUES (?, ?, ?, ?, 'running', ?)",
                    (run_id, agent["id"], agent["sector_id"], started, triggered_by),
                )
            try:
                findings, stats = self._execute_checks(agent, prev_counts)
                status = "completed"
            except Exception as exc:  # noqa: BLE001 — failure is a run outcome
                findings = [{"severity": "warning", "text": f"Run failed: {exc}"[:300]}]
                stats = {}
                status = "failed"
                logger.warning("agent %s checks failed: %s", agent["id"], exc)

            with self._connect() as conn:
                conn.execute(
                    "UPDATE agent_runs SET finished_at = ?, status = ?,"
                    " findings = ?, stats = ? WHERE id = ?",
                    (
                        _now(),
                        status,
                        json.dumps(findings, ensure_ascii=False),
                        json.dumps(stats, ensure_ascii=False),
                        run_id,
                    ),
                )
                # Mirror the latest outcome onto the definition so every
                # browser sees real findings on the next sync.
                conn.execute(
                    "UPDATE custom_agents SET findings = ?, last_run_at = ?,"
                    " updated_at = ? WHERE id = ?",
                    (
                        json.dumps(findings, ensure_ascii=False),
                        started,
                        _now(),
                        agent["id"],
                    ),
                )

            worst = self._worst_severity(findings)
            if worst in ("warning", "critical"):
                self._audit(
                    f"Agent finding ({worst})",
                    f"{agent.get('name', agent['id'])}: "
                    + "; ".join(f["text"] for f in findings if f["severity"] == worst)[
                        :400
                    ],
                )
            return self._last_run(agent["id"]) or {"id": run_id, "status": status}

    @staticmethod
    def _worst_severity(findings: list[dict]) -> str:
        order = {"info": 0, "warning": 1, "critical": 2}
        worst = "info"
        for f in findings:
            if order.get(str(f.get("severity")), 0) > order[worst]:
                worst = str(f["severity"])
        return worst

    def _resolve_tables(
        self, entities: list[str], catalog_entities: list[dict]
    ) -> dict[str, str]:
        """entity reference → physical table, matched against the draft
        entities (name, display_name, table) case-insensitively."""
        index: dict[str, str] = {}
        for e in catalog_entities:
            table = str(e.get("table", "") or "")
            if not table:
                continue
            for key in (e.get("name"), e.get("display_name"), table):
                if key:
                    index[str(key).strip().lower()] = table
        resolved: dict[str, str] = {}
        for ref in entities[:_MAX_ENTITIES_PER_AGENT]:
            match = index.get(str(ref).strip().lower())
            if match:
                resolved[ref] = match
        return resolved

    def _execute_checks(
        self, agent: dict, prev_counts: dict[str, int]
    ) -> tuple[list[dict], dict]:
        mgr, catalog_entities = self._get_context()
        resolved = self._resolve_tables(agent.get("entities") or [], catalog_entities)
        schema = mgr.get_schema_info()

        findings: list[dict] = []
        row_counts: dict[str, int] = {}

        unresolved = [
            ref
            for ref in (agent.get("entities") or [])[:_MAX_ENTITIES_PER_AGENT]
            if ref not in resolved
        ]
        for ref in unresolved:
            findings.append(
                {
                    "severity": "warning",
                    "text": f"Entity '{ref}' not found in the data model — skipped",
                }
            )

        for ref, table in resolved.items():
            count = self._row_count(mgr, table)
            row_counts[table] = count
            if count == 0:
                findings.append(
                    {"severity": "warning", "text": f"{ref}: no rows found"}
                )
                continue
            prev = prev_counts.get(table)
            if prev is not None and count != prev:
                delta = count - prev
                findings.append(
                    {
                        "severity": "warning" if delta < 0 else "info",
                        "text": (
                            f"{ref}: {delta:+d} rows since last run ({prev} → {count})"
                        ),
                    }
                )
            else:
                findings.append(
                    {"severity": "info", "text": f"{ref}: {count} rows, no anomaly"}
                )
            if agent.get("template") == "validator":
                findings.extend(
                    self._null_rate_findings(mgr, ref, table, count, schema)
                )

        if not resolved and not unresolved:
            findings.append(
                {
                    "severity": "info",
                    "text": "No entities configured — nothing to check",
                }
            )
        return findings[:_MAX_FINDINGS], {"row_counts": row_counts}

    @staticmethod
    def _row_count(mgr: Any, table: str) -> int:
        rows = mgr.execute(f"SELECT COUNT(*) FROM {_quote_ident(table)}")  # noqa: S608 — identifier quoted
        return int(rows[0][0]) if rows else 0

    @staticmethod
    def _null_rate_findings(
        mgr: Any, ref: str, table: str, count: int, schema: dict
    ) -> list[dict]:
        """Validator template: flag columns with a high share of NULLs."""
        columns = [
            str(c.get("name", ""))
            for c in (schema.get(table, {}).get("columns") or [])[
                :_MAX_NULL_CHECK_COLUMNS
            ]
            if c.get("name")
        ]
        if not columns or count == 0:
            return []
        selects = ", ".join(
            f"SUM(CASE WHEN {_quote_ident(c)} IS NULL THEN 1 ELSE 0 END)"
            for c in columns
        )
        rows = mgr.execute(f"SELECT {selects} FROM {_quote_ident(table)}")  # noqa: S608
        if not rows:
            return []
        out: list[dict] = []
        for col, nulls in zip(columns, rows[0]):
            share = (nulls or 0) / count
            if share >= 0.5:
                out.append(
                    {
                        "severity": "warning",
                        "text": f"{ref}.{col}: {share:.0%} NULL values",
                    }
                )
        return out
