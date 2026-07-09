"""Curation API endpoint tests — auth, report shape, and the asynchronous
LLM advisory job (start → poll → done, 503 without a provider, 409 while a
run is in progress). The LLM itself is always faked — no network."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


def _hash(pw: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 120_000)
    return f"pbkdf2_sha256$120000${salt}${base64.b64encode(digest).decode()}"


@pytest.fixture(scope="module")
def clients():
    os.environ["AUTH_USERS_JSON"] = json.dumps(
        [
            {
                "username": "usr",
                "password_hash": _hash("pw"),
                "role": "user",
                "disabled": False,
            },
            {
                "username": "adm",
                "password_hash": _hash("pw"),
                "role": "admin",
                "disabled": False,
            },
        ]
    )
    os.environ["JWT_SECRET_KEY"] = "curation-api-test-secret"
    os.environ["SEMANTIC_REQUIRE_LLM_INTENT"] = "0"

    import app.main as m
    from fastapi.testclient import TestClient

    limiter = getattr(m.app.state, "limiter", None)
    if limiter:
        limiter.enabled = False
    with TestClient(m.app) as c:
        headers = {}
        for username in ("usr", "adm"):
            resp = c.post(
                "/api/auth/token", data={"username": username, "password": "pw"}
            )
            headers[username] = {
                "Authorization": f"Bearer {resp.json()['access_token']}"
            }
        yield c, headers["usr"], headers["adm"]


@pytest.fixture(autouse=True)
def _reset_job_state():
    import app.curation.router as router_mod

    with router_mod._JOB_LOCK:
        router_mod._job.clear()
        router_mod._job["status"] = "idle"
    yield


def _wait_for_job(client, admin, want=("done", "error"), timeout=10.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = client.get("/api/curation/advise/status", headers=admin).json()
        if status.get("status") in want:
            return status
        time.sleep(0.05)
    raise AssertionError(f"advisory job did not reach {want} in {timeout}s: {status}")


def test_endpoints_require_auth(clients):
    client, _user, _admin = clients
    assert client.get("/api/curation/report").status_code == 401
    assert client.post("/api/curation/advise").status_code == 401
    assert client.get("/api/curation/advise/status").status_code == 401
    assert client.get("/api/curation/skills").status_code == 401


def test_advise_is_admin_only(clients):
    client, user, _admin = clients
    assert client.post("/api/curation/advise", headers=user).status_code == 403
    assert client.get("/api/curation/advise/status", headers=user).status_code == 403


def test_report_shape(clients):
    client, user, _admin = clients
    r = client.get("/api/curation/report", headers=user)
    assert r.status_code == 200
    body = r.json()
    assert set(body) >= {"kept", "excluded", "uncertain", "counts"}


def test_advise_503_without_provider(clients, monkeypatch):
    client, _user, admin = clients
    import app.curation.llm_advisor as advisor_mod

    monkeypatch.setattr(advisor_mod, "llm_available", lambda: False)
    r = client.post("/api/curation/advise", headers=admin)
    assert r.status_code == 503


def test_advise_job_runs_and_reports_result(clients, monkeypatch):
    client, _user, admin = clients
    import app.curation.llm_advisor as advisor_mod

    fake_result = {
        "applied": [],
        "merge_proposals": [],
        "skipped_low_confidence": [{"table": "x", "confidence": 0.4, "reason": "?"}],
    }
    monkeypatch.setattr(advisor_mod, "llm_available", lambda: True)
    monkeypatch.setattr(advisor_mod, "advise", lambda *a, **kw: fake_result)

    r = client.post("/api/curation/advise", headers=admin, json={"force": True})
    assert r.status_code == 202
    assert r.json()["status"] == "running"

    status = _wait_for_job(client, admin)
    assert status["status"] == "done"
    assert status["result"] == fake_result
    assert status["started_by"] == "adm"
    assert status["force"] is True


def test_advise_409_while_running_and_error_state(clients, monkeypatch):
    client, _user, admin = clients
    import app.curation.llm_advisor as advisor_mod

    release = threading.Event()

    def _blocking_advise(*a, **kw):
        release.wait(timeout=10)
        raise RuntimeError("provider exploded")

    monkeypatch.setattr(advisor_mod, "llm_available", lambda: True)
    monkeypatch.setattr(advisor_mod, "advise", _blocking_advise)

    assert client.post("/api/curation/advise", headers=admin).status_code == 202
    # Second start while the first is still running → 409.
    assert client.post("/api/curation/advise", headers=admin).status_code == 409
    release.set()

    status = _wait_for_job(client, admin)
    assert status["status"] == "error"
    assert "provider exploded" in status["error"]
