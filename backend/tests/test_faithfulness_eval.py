"""Automated faithfulness evaluation over golden questions.

Writes report to faithfulness_report.json and enforces minimum grounded score.
Run in CI with:
  RUN_FAITHFULNESS_EVAL=1 python -m pytest -q tests/test_faithfulness_eval.py -s
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.test_golden_questions import GOLDEN_QUESTIONS

ROOT = Path(__file__).parent.parent.parent
REPORT_PATH = ROOT / "faithfulness_report.json"


def _password_hash(password: str, iterations: int = 120_000) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations
    )
    return (
        f"pbkdf2_sha256${iterations}${salt}${base64.b64encode(digest).decode('ascii')}"
    )


@pytest.fixture(scope="session", autouse=True)
def _test_auth_env() -> None:
    users = [
        {
            "username": "faithfulness_user",
            "password_hash": _password_hash("faithfulness_password"),
            "role": "admin",
            "disabled": False,
        }
    ]
    os.environ["AUTH_USERS_JSON"] = json.dumps(users)
    os.environ["JWT_SECRET_KEY"] = "faithfulness-test-secret-key-not-for-production"
    os.environ["SEMANTIC_REQUIRE_LLM_INTENT"] = "0"


@pytest.fixture(scope="session")
def app_instance():
    import sys

    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.main import app

    limiter = getattr(app.state, "limiter", None)
    if limiter is not None:
        setattr(limiter, "enabled", False)
    return app


@pytest.fixture(scope="session")
def client(app_instance) -> TestClient:
    with TestClient(app_instance) as c:
        yield c


@pytest.fixture(scope="session")
def auth_headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/auth/token",
        data={"username": "faithfulness_user", "password": "faithfulness_password"},
    )
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def allowed_intents() -> set[str]:
    import sys

    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.semantic.layer import _INTENT_CONTRACTS

    return set(_INTENT_CONTRACTS.keys())


@pytest.mark.faithfulness
@pytest.mark.skipif(
    os.getenv("RUN_FAITHFULNESS_EVAL", "0").strip().lower() not in {"1", "true", "yes"},
    reason="Faithfulness eval is opt-in",
)
def test_faithfulness_grounding_score(client, auth_headers, allowed_intents) -> None:
    threshold = float(os.getenv("FAITHFULNESS_MIN_SCORE", "0.90"))
    details: list[dict[str, Any]] = []
    faithful_count = 0

    for case in GOLDEN_QUESTIONS:
        response = client.post(
            "/api/semantic/ask",
            json={"question": case["question"]},
            headers=auth_headers,
        )
        ok = response.status_code == 200
        body: dict[str, Any] = response.json() if ok else {}
        provenance = body.get("provenance") or {}
        lineage = provenance.get("lineage") or {}
        intent = (
            (provenance.get("ontology_intent") or {}).get("intent_type") or ""
        ).strip()

        connectors = lineage.get("connectors") or []
        tables = lineage.get("tables") or []
        grounded = bool(connectors and tables)
        intent_ok = intent in allowed_intents
        faithful = ok and grounded and intent_ok
        faithful_count += int(faithful)

        details.append(
            {
                "id": case["id"],
                "status": response.status_code,
                "intent": intent,
                "intent_ok": intent_ok,
                "grounded": grounded,
                "connectors": connectors,
                "tables": tables,
                "faithful": faithful,
            }
        )

    score = faithful_count / len(GOLDEN_QUESTIONS)
    report = {
        "questions": len(GOLDEN_QUESTIONS),
        "faithful": faithful_count,
        "score": round(score, 4),
        "threshold": threshold,
        "passed": score >= threshold,
        "details": details,
    }
    REPORT_PATH.write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print("\n=== Faithfulness Evaluation ===")
    print(f"Questions: {report['questions']}")
    print(f"Faithful: {report['faithful']}")
    print(f"Score: {report['score']:.4f}")
    print(f"Threshold: {threshold:.4f}")
    print(f"Report saved to: {REPORT_PATH}")

    assert score >= threshold, (
        f"Faithfulness score regression: {score:.4f} < {threshold:.4f}"
    )
