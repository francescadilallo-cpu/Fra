"""Server-side agent runtime tests — due-scheduling, real check execution
against a fake manager, findings mirroring, audit hook, API endpoints."""

from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.agentic.runtime import AgentRuntime


def _make_agents_db(path: Path) -> None:
    conn = sqlite3.connect(str(path))
    conn.execute(
        """
        CREATE TABLE custom_agents (
            id TEXT PRIMARY KEY, sector_id TEXT NOT NULL, name TEXT NOT NULL,
            description TEXT DEFAULT '', template TEXT DEFAULT 'monitor',
            entities TEXT DEFAULT '[]', findings TEXT DEFAULT '[]',
            actions TEXT DEFAULT '[]', trigger TEXT DEFAULT '{"kind":"manual"}',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_run_at TEXT
        )
        """
    )
    conn.commit()
    conn.close()


def _insert_agent(
    path: Path,
    agent_id: str = "a1",
    sector: str = "live-manufacturing",
    template: str = "monitor",
    entities: list[str] | None = None,
    trigger: dict | None = None,
) -> None:
    conn = sqlite3.connect(str(path))
    conn.execute(
        "INSERT INTO custom_agents (id, sector_id, name, template, entities,"
        " trigger, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            agent_id,
            sector,
            f"Agent {agent_id}",
            template,
            json.dumps(entities or ["Account"]),
            json.dumps(trigger or {"kind": "schedule", "interval": "5min"}),
            "2026-01-01T00:00:00+00:00",
            "2026-01-01T00:00:00+00:00",
        ),
    )
    conn.commit()
    conn.close()


class FakeMgr:
    """Answers COUNT(*) and NULL-share queries for a static schema."""

    def __init__(self, tables: dict[str, dict]) -> None:
        # tables: name → {"rows": N, "columns": [...], "nulls": {col: n}}
        self.tables = tables

    def get_schema_info(self) -> dict[str, dict]:
        return {
            t: {
                "row_count": spec["rows"],
                "columns": [{"name": c} for c in spec.get("columns", [])],
            }
            for t, spec in self.tables.items()
        }

    def execute(self, sql: str):
        table = sql.rsplit("FROM", 1)[1].strip().strip('"')
        spec = self.tables[table]
        if sql.startswith("SELECT COUNT(*)"):
            return [(spec["rows"],)]
        # NULL-share query: one SUM per column, in column order
        nulls = spec.get("nulls", {})
        return [tuple(nulls.get(c, 0) for c in spec.get("columns", []))]


def _runtime(tmp_path, tables: dict[str, dict], entities=None, audit=None):
    db = tmp_path / "custom_agents.db"
    if not db.exists():
        _make_agents_db(db)
    mgr = FakeMgr(tables)
    catalog_entities = entities or [
        {"name": "sf_x_account", "display_name": "Account", "table": "sf_x_account"}
    ]
    return (
        AgentRuntime(
            db_path=db,
            get_context=lambda: (mgr, catalog_entities),
            audit=audit,
        ),
        db,
        mgr,
    )


class TestScheduling:
    def test_live_scheduled_agent_is_due_once_per_interval(self, tmp_path):
        rt, db, _ = _runtime(tmp_path, {"sf_x_account": {"rows": 5}})
        _insert_agent(db)
        assert rt.tick() == 1
        # Immediately after, the interval has not elapsed.
        assert rt.tick() == 0

    def test_demo_and_manual_agents_never_scheduled(self, tmp_path):
        rt, db, _ = _runtime(tmp_path, {"sf_x_account": {"rows": 5}})
        _insert_agent(db, agent_id="demo1", sector="manufacturing")
        _insert_agent(
            db, agent_id="manual1", sector="live-x", trigger={"kind": "manual"}
        )
        _insert_agent(
            db,
            agent_id="event1",
            sector="live-x",
            trigger={"kind": "event", "on": "pipeline-complete"},
        )
        assert rt.tick() == 0

    def test_due_again_after_interval_elapses(self, tmp_path):
        rt, db, _ = _runtime(tmp_path, {"sf_x_account": {"rows": 5}})
        _insert_agent(db)
        rt.tick()
        # Backdate the run beyond the 5-minute interval.
        conn = sqlite3.connect(str(db))
        old = (datetime.now(timezone.utc) - timedelta(minutes=6)).isoformat()
        conn.execute("UPDATE agent_runs SET started_at = ?", (old,))
        conn.commit()
        conn.close()
        assert rt.tick() == 1


class TestExecution:
    def _agent(self, entities=None, template="monitor"):
        return {
            "id": "a1",
            "sector_id": "live-x",
            "name": "Agent a1",
            "template": template,
            "entities": entities or ["Account"],
        }

    def test_row_count_and_mirrored_findings(self, tmp_path):
        rt, db, _ = _runtime(tmp_path, {"sf_x_account": {"rows": 42}})
        _insert_agent(db)
        run = rt.run_agent(self._agent())
        assert run["status"] == "completed"
        assert any("42 rows" in f["text"] for f in run["findings"])
        assert run["stats"]["row_counts"] == {"sf_x_account": 42}
        # Definition mirrors the outcome for the UI.
        conn = sqlite3.connect(str(db))
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM custom_agents WHERE id='a1'").fetchone()
        conn.close()
        assert json.loads(row["findings"]) == run["findings"]
        assert row["last_run_at"] is not None

    def test_row_drop_becomes_warning_with_delta(self, tmp_path):
        tables = {"sf_x_account": {"rows": 100}}
        rt, db, mgr = _runtime(tmp_path, tables)
        _insert_agent(db)
        rt.run_agent(self._agent())
        mgr.tables["sf_x_account"]["rows"] = 90
        run = rt.run_agent(self._agent())
        drop = [f for f in run["findings"] if "-10 rows" in f["text"]]
        assert drop and drop[0]["severity"] == "warning"

    def test_empty_table_and_unresolved_entity_warn(self, tmp_path):
        rt, db, _ = _runtime(tmp_path, {"sf_x_account": {"rows": 0}})
        _insert_agent(db)
        run = rt.run_agent(self._agent(entities=["Account", "Ghost"]))
        texts = [f["text"] for f in run["findings"]]
        assert any("no rows" in t for t in texts)
        assert any("Ghost" in t and "not found" in t for t in texts)

    def test_validator_flags_high_null_columns(self, tmp_path):
        tables = {
            "sf_x_account": {
                "rows": 10,
                "columns": ["id", "vat"],
                "nulls": {"id": 0, "vat": 7},
            }
        }
        rt, db, _ = _runtime(tmp_path, tables)
        _insert_agent(db, template="validator")
        run = rt.run_agent(self._agent(template="validator"))
        null_findings = [f for f in run["findings"] if "NULL values" in f["text"]]
        assert len(null_findings) == 1
        assert "vat" in null_findings[0]["text"]
        assert null_findings[0]["severity"] == "warning"

    def test_warning_triggers_audit_hook(self, tmp_path):
        audited: list[tuple] = []
        rt, db, _ = _runtime(
            tmp_path,
            {"sf_x_account": {"rows": 0}},
            audit=lambda a, r: audited.append((a, r)),
        )
        _insert_agent(db)
        rt.run_agent(self._agent())
        assert audited and "warning" in audited[0][0]

    def test_context_failure_is_a_failed_run_not_a_crash(self, tmp_path):
        db = tmp_path / "custom_agents.db"
        _make_agents_db(db)
        _insert_agent(db)

        def _boom():
            raise RuntimeError("sources offline")

        rt = AgentRuntime(db_path=db, get_context=_boom)
        run = rt.run_agent(
            {
                "id": "a1",
                "sector_id": "live-x",
                "name": "A",
                "template": "monitor",
                "entities": ["Account"],
            }
        )
        assert run["status"] == "failed"
        assert any("sources offline" in f["text"] for f in run["findings"])


class TestRuntimeEndpoints:
    @pytest.fixture()
    def client(self):
        import base64
        import hashlib
        import os
        import secrets

        def _hash(pw):
            salt = secrets.token_hex(16)
            digest = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 120_000)
            return f"pbkdf2_sha256$120000${salt}${base64.b64encode(digest).decode()}"

        os.environ["AUTH_USERS_JSON"] = json.dumps(
            [
                {
                    "username": "u",
                    "password_hash": _hash("pw"),
                    "role": "user",
                    "disabled": False,
                }
            ]
        )
        os.environ["JWT_SECRET_KEY"] = "agent-runtime-test-secret-32bytes!!"
        os.environ["SEMANTIC_REQUIRE_LLM_INTENT"] = "0"

        import app.main as m
        from fastapi.testclient import TestClient

        limiter = getattr(m.app.state, "limiter", None)
        if limiter:
            limiter.enabled = False
        with TestClient(m.app) as c:
            r = c.post("/api/auth/token", data={"username": "u", "password": "pw"})
            yield c, {"Authorization": f"Bearer {r.json()['access_token']}"}

    def test_run_and_history_endpoints(self, client):
        import uuid

        c, h = client
        agent = {
            "id": f"rt-test-agent-{uuid.uuid4().hex[:8]}",
            "sector_id": "live-manufacturing",
            "name": "RT Test",
            "template": "monitor",
            "entities": ["ghost_entity_xyz"],
            "findings": [],
            "actions": [],
            "trigger": {"kind": "manual"},
        }
        assert c.post("/api/agents/custom", json=agent, headers=h).status_code == 201
        try:
            r = c.post(f"/api/agents/custom/{agent['id']}/run", headers=h)
            assert r.status_code == 200
            run = r.json()
            assert run["status"] in ("completed", "failed")
            assert run["triggered_by"].startswith("manual:")

            r = c.get(f"/api/agents/custom/{agent['id']}/runs", headers=h)
            assert r.status_code == 200
            assert len(r.json()) == 1
        finally:
            c.delete(f"/api/agents/custom/{agent['id']}", headers=h)

    def test_run_unknown_agent_404(self, client):
        c, h = client
        assert (
            c.post("/api/agents/custom/no-such-agent/run", headers=h).status_code == 404
        )
