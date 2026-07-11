"""Workspace digest tests — due-scheduling by interval, aggregation of agent
runs since the last digest, extras merging, delivery flag, off switch."""

from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.agentic.digest import DigestService


def _make_db(path: Path) -> None:
    conn = sqlite3.connect(str(path))
    conn.execute(
        "CREATE TABLE custom_agents (id TEXT PRIMARY KEY, sector_id TEXT,"
        " name TEXT, description TEXT, template TEXT, entities TEXT,"
        " findings TEXT, actions TEXT, trigger TEXT, created_at TEXT,"
        " updated_at TEXT, last_run_at TEXT)"
    )
    conn.execute(
        "CREATE TABLE agent_runs (id TEXT PRIMARY KEY, agent_id TEXT,"
        " sector_id TEXT, started_at TEXT, finished_at TEXT, status TEXT,"
        " triggered_by TEXT, findings TEXT, stats TEXT)"
    )
    conn.execute(
        "INSERT INTO custom_agents (id, sector_id, name, created_at, updated_at)"
        " VALUES ('a1', 'live-x', 'Revenue Monitor', '2026-01-01', '2026-01-01')"
    )
    conn.commit()
    conn.close()


def _insert_run(path: Path, findings: list[dict], status="completed", ago_hours=1):
    conn = sqlite3.connect(str(path))
    started = (datetime.now(timezone.utc) - timedelta(hours=ago_hours)).isoformat()
    conn.execute(
        "INSERT INTO agent_runs (id, agent_id, sector_id, started_at, status,"
        " triggered_by, findings, stats) VALUES (?, 'a1', 'live-x', ?, ?,"
        " 'schedule', ?, '{}')",
        (f"r{ago_hours}-{status}", started, status, json.dumps(findings)),
    )
    conn.commit()
    conn.close()


def test_first_digest_is_due_then_respects_interval(tmp_path, monkeypatch):
    monkeypatch.setenv("FRA_DIGEST_INTERVAL", "daily")
    db = tmp_path / "d.db"
    _make_db(db)
    svc = DigestService(db)
    assert svc.due() is True
    svc.run()
    assert svc.due() is False


def test_off_disables_scheduling(tmp_path, monkeypatch):
    monkeypatch.setenv("FRA_DIGEST_INTERVAL", "off")
    db = tmp_path / "d.db"
    _make_db(db)
    svc = DigestService(db)
    assert svc.due() is False
    svc.tick()
    assert svc.latest() is None


def test_aggregates_runs_extras_and_highlights(tmp_path, monkeypatch):
    monkeypatch.setenv("FRA_DIGEST_INTERVAL", "daily")
    db = tmp_path / "d.db"
    _make_db(db)
    _insert_run(
        db,
        [
            {"severity": "warning", "text": "Account: -10 rows since last run"},
            {"severity": "info", "text": "Order: 500 rows, no anomaly"},
        ],
        ago_hours=2,
    )
    _insert_run(
        db, [{"severity": "critical", "text": "boom"}], status="failed", ago_hours=1
    )

    delivered: list[dict] = []
    svc = DigestService(
        db,
        get_extras=lambda: {"pending_approvals": 3, "curation_uncertain_tables": 7},
        deliver=delivered.append,
    )
    digest = svc.run()

    assert digest["agent_runs"] == 2
    assert digest["failed_runs"] == 1
    assert digest["findings_by_severity"] == {"critical": 1, "warning": 1, "info": 1}
    # Highlights: critical first, agent resolved to its display name.
    assert digest["highlights"][0]["severity"] == "critical"
    assert digest["highlights"][1]["agent"] == "Revenue Monitor"
    assert digest["pending_approvals"] == 3
    assert digest["curation_uncertain_tables"] == 7
    assert delivered and delivered[0]["agent_runs"] == 2
    assert digest["delivered"] is True

    stored = svc.latest()
    assert stored is not None and stored["delivered"] is True


def test_next_digest_only_covers_new_activity(tmp_path, monkeypatch):
    monkeypatch.setenv("FRA_DIGEST_INTERVAL", "daily")
    db = tmp_path / "d.db"
    _make_db(db)
    _insert_run(db, [{"severity": "info", "text": "old"}], ago_hours=5)
    svc = DigestService(db)
    assert svc.run()["agent_runs"] == 1
    # A second forced digest starts from the first one's timestamp.
    assert svc.run()["agent_runs"] == 0


def test_delivery_failure_still_persists_digest(tmp_path, monkeypatch):
    monkeypatch.setenv("FRA_DIGEST_INTERVAL", "daily")
    db = tmp_path / "d.db"
    _make_db(db)

    def _boom(_digest):
        raise RuntimeError("webhook down")

    svc = DigestService(db, deliver=_boom)
    digest = svc.run()
    assert digest["delivered"] is False
    assert svc.latest() is not None and svc.latest()["delivered"] is False
