"""API tests for Executive Agentic Layer endpoints.

These tests exercise the real agentic router and service with a minimal
FastAPI app and an isolated sqlite DB, avoiding full app bootstrap deps.
"""

from __future__ import annotations

import sqlite3
import sys
import threading
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import Header, HTTPException, status
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))
from app.agentic.executive import ExecutiveAgenticLayer
from app.agentic.executive import AgentExecutionError
from app.agentic.router import build_agent_router


class _StubOntology:
    def entity_names(self) -> list[str]:
        return ["SalesOrder"]

    def entity(self, name: str):
        if name != "SalesOrder":
            raise KeyError(name)

        class _SalesOrder:
            model_fields = {"order_date": object()}

        return _SalesOrder


def _admin_dependency(
    authorization: str | None = Header(default=None),
) -> SimpleNamespace:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    if authorization == "Bearer user-token":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient role",
        )
    if authorization != "Bearer admin-token":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )
    return SimpleNamespace(username="qa_admin", role="admin")


@pytest.fixture(scope="session")
def db_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    db_dir = tmp_path_factory.mktemp("agentic-db")
    db_file = db_dir / "agentic.sqlite"
    conn = sqlite3.connect(str(db_file))
    try:
        conn.execute(
            """
            CREATE TABLE orders (
                id INTEGER PRIMARY KEY,
                date TEXT NOT NULL,
                delivery_date TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "INSERT INTO orders (id, date, delivery_date) VALUES (?, ?, ?)",
            (1, "2026-01-10", "2026-01-20"),
        )
        conn.commit()
    finally:
        conn.close()
    return db_file


@pytest.fixture(scope="session")
def app_instance(db_path: Path) -> FastAPI:
    def _get_db_connection() -> sqlite3.Connection:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        return conn

    layer = ExecutiveAgenticLayer(
        get_ontology=lambda: _StubOntology(),
        get_db_connection=_get_db_connection,
    )

    app = FastAPI()
    app.state.agentic_layer = layer
    app.include_router(build_agent_router(layer, _admin_dependency))
    return app


@pytest.fixture(scope="session")
def client(app_instance: FastAPI) -> TestClient:
    with TestClient(app_instance) as c:
        yield c


@pytest.fixture(scope="session")
def admin_headers() -> dict[str, str]:
    return {"Authorization": "Bearer admin-token"}


@pytest.fixture(scope="session")
def user_headers() -> dict[str, str]:
    return {"Authorization": "Bearer user-token"}


@pytest.fixture(scope="session")
def agentic_layer(app_instance: FastAPI) -> ExecutiveAgenticLayer:
    return app_instance.state.agentic_layer


def _get_first_order(db_path: Path) -> tuple[int, date, str | None]:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "SELECT id, date, delivery_date FROM orders ORDER BY id LIMIT 1"
        ).fetchone()
        assert row is not None, "No orders in test database"
        delivery_raw = row["delivery_date"]
        return (
            int(row["id"]),
            date.fromisoformat(str(row["date"])),
            str(delivery_raw) if delivery_raw else None,
        )
    finally:
        conn.close()


def _set_order_delivery_date(
    db_path: Path, order_id: int, delivery_date_iso: str | None
) -> None:
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            "UPDATE orders SET delivery_date = ? WHERE id = ?",
            (delivery_date_iso, order_id),
        )
        conn.commit()
    finally:
        conn.close()


def test_execute_returns_pending_human_approval(
    client: TestClient,
    admin_headers: dict[str, str],
    db_path: Path,
) -> None:
    order_id, order_date, _ = _get_first_order(db_path)
    proposed_date = (order_date + timedelta(days=7)).isoformat()

    response = client.post(
        "/api/agent/execute",
        json={
            "command": f"Sposta la data di consegna dell'ordine {order_id} al {proposed_date}"
        },
        headers=admin_headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "PENDING_HUMAN_APPROVAL"
    assert body["proposed_action"]["action_type"] == "UPDATE_ORDER_DELIVERY_DATE"
    assert body["validation_checks"], "Expected non-empty semantic validation checks"


def test_approve_executes_writeback(
    client: TestClient,
    admin_headers: dict[str, str],
    db_path: Path,
) -> None:
    order_id, order_date, original_delivery_date = _get_first_order(db_path)
    new_date = (order_date + timedelta(days=10)).isoformat()

    create_resp = client.post(
        "/api/agent/execute",
        json={
            "command": f"Sposta la data di consegna dell'ordine {order_id} al {new_date}"
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 200, create_resp.text
    action_id = create_resp.json()["action_id"]

    approve_resp = client.post(
        f"/api/agent/approve/{action_id}",
        json={"approve": True, "manager_note": "Approved by QA manager"},
        headers=admin_headers,
    )
    assert approve_resp.status_code == 200, approve_resp.text
    body = approve_resp.json()
    assert body["status"] in ("SYNCED", "SYNC_FAILED")
    assert body["resync_result"] is not None

    # Restore original DB state for repeatable tests.
    _set_order_delivery_date(db_path, order_id, original_delivery_date)


def test_reject_keeps_action_rejected(
    client: TestClient,
    admin_headers: dict[str, str],
    db_path: Path,
) -> None:
    order_id, order_date, _ = _get_first_order(db_path)
    proposed_date = (order_date + timedelta(days=3)).isoformat()

    create_resp = client.post(
        "/api/agent/execute",
        json={
            "command": f"Sposta la data di consegna dell'ordine {order_id} al {proposed_date}"
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 200, create_resp.text
    action_id = create_resp.json()["action_id"]

    reject_resp = client.post(
        f"/api/agent/approve/{action_id}",
        json={"approve": False, "manager_note": "Business priority changed"},
        headers=admin_headers,
    )
    assert reject_resp.status_code == 200, reject_resp.text
    body = reject_resp.json()
    assert body["status"] == "REJECTED"
    assert body["manager_note"] == "Business priority changed"


def test_execute_invalid_command_returns_controlled_422(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/agent/execute",
        json={"command": "Aggiorna tutto il sistema e fai deploy"},
        headers=admin_headers,
    )
    assert response.status_code == 422
    detail = response.json().get("detail", {})
    assert detail.get("error") == "AGENT_VALIDATION_FAILED"


def test_execute_business_rule_violation_returns_controlled_422(
    client: TestClient,
    admin_headers: dict[str, str],
    db_path: Path,
) -> None:
    order_id, order_date, _ = _get_first_order(db_path)
    invalid_date = (order_date - timedelta(days=1)).isoformat()

    response = client.post(
        "/api/agent/execute",
        json={
            "command": f"Sposta la data di consegna dell'ordine {order_id} al {invalid_date}"
        },
        headers=admin_headers,
    )
    assert response.status_code == 422
    detail = response.json().get("detail", {})
    assert detail.get("error") == "AGENT_VALIDATION_FAILED"


def test_approve_unknown_action_returns_404(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/agent/approve/not-existing-action-id",
        json={"approve": True},
        headers=admin_headers,
    )
    assert response.status_code == 404
    detail = response.json().get("detail", {})
    assert detail.get("error") == "AGENT_ACTION_NOT_FOUND"


def test_audit_endpoint_returns_semantic_trace(
    client: TestClient,
    admin_headers: dict[str, str],
    db_path: Path,
) -> None:
    order_id, order_date, _ = _get_first_order(db_path)
    proposed_date = (order_date + timedelta(days=5)).isoformat()

    exec_resp = client.post(
        "/api/agent/execute",
        json={
            "command": f"Sposta la data di consegna dell'ordine {order_id} al {proposed_date}"
        },
        headers=admin_headers,
    )
    assert exec_resp.status_code == 200, exec_resp.text
    action_id = exec_resp.json()["action_id"]

    audit_resp = client.get("/api/agent/audit?limit=100", headers=admin_headers)
    assert audit_resp.status_code == 200, audit_resp.text
    records = audit_resp.json().get("records", [])
    assert records, "Expected non-empty semantic audit records"

    action_records = [r for r in records if r.get("action_id") == action_id]
    phases = {r.get("phase") for r in action_records}
    assert "PROPOSED" in phases or "VALIDATED" in phases
    assert "QUEUED" in phases


def test_execute_requires_auth(client: TestClient) -> None:
    response = client.post(
        "/api/agent/execute",
        json={"command": "Sposta la data di consegna dell'ordine 1 al 2027-01-01"},
    )
    assert response.status_code == 401


def test_execute_requires_admin_role(
    client: TestClient, user_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/agent/execute",
        json={"command": "Sposta la data di consegna dell'ordine 1 al 2027-01-01"},
        headers=user_headers,
    )
    assert response.status_code == 403


def test_audit_requires_admin_role(
    client: TestClient, user_headers: dict[str, str]
) -> None:
    response = client.get("/api/agent/audit", headers=user_headers)
    assert response.status_code == 403


def test_second_approve_after_executed_returns_409(
    client: TestClient,
    admin_headers: dict[str, str],
    db_path: Path,
) -> None:
    order_id, order_date, original_delivery_date = _get_first_order(db_path)
    new_date = (order_date + timedelta(days=12)).isoformat()

    create_resp = client.post(
        "/api/agent/execute",
        json={
            "command": f"Sposta la data di consegna dell'ordine {order_id} al {new_date}"
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 200, create_resp.text
    action_id = create_resp.json()["action_id"]

    first_approve = client.post(
        f"/api/agent/approve/{action_id}",
        json={"approve": True, "manager_note": "First approval"},
        headers=admin_headers,
    )
    assert first_approve.status_code == 200, first_approve.text
    assert first_approve.json()["status"] in ("SYNCED", "SYNC_FAILED")

    second_approve = client.post(
        f"/api/agent/approve/{action_id}",
        json={"approve": True, "manager_note": "Second approval should fail"},
        headers=admin_headers,
    )
    assert second_approve.status_code == 409, second_approve.text
    detail = second_approve.json().get("detail", {})
    assert detail.get("error") == "AGENT_ACTION_EXECUTION_FAILED"

    _set_order_delivery_date(db_path, order_id, original_delivery_date)


def test_concurrent_double_approval_is_lock_safe(
    agentic_layer: ExecutiveAgenticLayer,
    db_path: Path,
) -> None:
    order_id, order_date, original_delivery_date = _get_first_order(db_path)
    new_date = (order_date + timedelta(days=15)).isoformat()

    action = agentic_layer.submit_command(
        command=f"Sposta la data di consegna dell'ordine {order_id} al {new_date}",
        actor="qa_admin",
        actor_role="admin",
    )

    barrier = threading.Barrier(2)
    statuses: list[str] = []
    errors: list[Exception] = []

    def _approve() -> None:
        try:
            barrier.wait()
            result = agentic_layer.approve_action(
                action_id=action.action_id,
                actor="qa_admin",
                actor_role="admin",
                approve=True,
                manager_note="Concurrent approval test",
            )
            statuses.append(result.status)
        except (
            Exception
        ) as exc:  # pragma: no cover - assertion inspects captured errors
            errors.append(exc)

    t1 = threading.Thread(target=_approve)
    t2 = threading.Thread(target=_approve)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert statuses.count("SYNCED") + statuses.count("SYNC_FAILED") == 1
    assert len(errors) == 1
    assert isinstance(errors[0], AgentExecutionError)
    assert "cannot be approved" in str(errors[0])

    _set_order_delivery_date(db_path, order_id, original_delivery_date)


def test_approve_resync_result_populated(
    client: TestClient,
    admin_headers: dict[str, str],
    db_path: Path,
) -> None:
    order_id, order_date, original_delivery_date = _get_first_order(db_path)
    new_date = (order_date + timedelta(days=8)).isoformat()

    create_resp = client.post(
        "/api/agent/execute",
        json={
            "command": f"Sposta la data di consegna dell'ordine {order_id} al {new_date}"
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 200, create_resp.text
    action_id = create_resp.json()["action_id"]

    approve_resp = client.post(
        f"/api/agent/approve/{action_id}",
        json={"approve": True},
        headers=admin_headers,
    )
    assert approve_resp.status_code == 200, approve_resp.text
    body = approve_resp.json()
    assert body["status"] in ("SYNCED", "SYNC_FAILED")
    resync = body["resync_result"]
    assert resync is not None
    assert "nodes_patched" in resync
    assert "cache_keys_invalidated" in resync
    assert "duration_ms" in resync
    assert "errors" in resync

    audit_resp = client.get("/api/agent/audit?limit=100", headers=admin_headers)
    assert audit_resp.status_code == 200
    phases = {
        r["phase"]
        for r in audit_resp.json()["records"]
        if r.get("action_id") == action_id
    }
    assert "EXECUTED" in phases
    assert "RESYNCED" in phases

    _set_order_delivery_date(db_path, order_id, original_delivery_date)


def test_get_action_status_endpoint(
    client: TestClient,
    admin_headers: dict[str, str],
    db_path: Path,
) -> None:
    order_id, order_date, _ = _get_first_order(db_path)
    proposed_date = (order_date + timedelta(days=6)).isoformat()

    create_resp = client.post(
        "/api/agent/execute",
        json={
            "command": f"Sposta la data di consegna dell'ordine {order_id} al {proposed_date}"
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 200, create_resp.text
    action_id = create_resp.json()["action_id"]

    status_resp = client.get(f"/api/agent/status/{action_id}", headers=admin_headers)
    assert status_resp.status_code == 200, status_resp.text
    body = status_resp.json()
    assert body["action_id"] == action_id
    assert body["status"] == "PENDING_HUMAN_APPROVAL"
    assert body["resync_result"] is None


def test_get_action_status_unknown_returns_404(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    resp = client.get("/api/agent/status/no-such-id", headers=admin_headers)
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "AGENT_ACTION_NOT_FOUND"
