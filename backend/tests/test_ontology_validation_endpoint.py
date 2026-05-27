from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
from pathlib import Path

from fastapi.testclient import TestClient


def _password_hash(password: str, iterations: int = 120_000) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations
    )
    return (
        f"pbkdf2_sha256${iterations}${salt}${base64.b64encode(digest).decode('ascii')}"
    )


def test_validate_ontology_endpoint_success_default_file() -> None:
    users = [
        {
            "username": "onto_admin",
            "password_hash": _password_hash("onto_password"),
            "role": "admin",
            "disabled": False,
        }
    ]
    os.environ["AUTH_USERS_JSON"] = json.dumps(users)
    os.environ["JWT_SECRET_KEY"] = "onto-test-secret-key-not-for-production"

    import sys

    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.main import app

    limiter = getattr(app.state, "limiter", None)
    if limiter is not None:
        setattr(limiter, "enabled", False)

    with TestClient(app) as client:
        token_resp = client.post(
            "/api/auth/token",
            data={"username": "onto_admin", "password": "onto_password"},
        )
        assert token_resp.status_code == 200, token_resp.text
        token = token_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        response = client.post("/api/ontology/validate", json={}, headers=headers)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["valid"] is True
        assert "entities" in body


def test_validate_ontology_endpoint_hard_fails_dirty_file() -> None:
    users = [
        {
            "username": "onto_admin2",
            "password_hash": _password_hash("onto_password2"),
            "role": "admin",
            "disabled": False,
        }
    ]
    os.environ["AUTH_USERS_JSON"] = json.dumps(users)
    os.environ["JWT_SECRET_KEY"] = "onto-test-secret-key-not-for-production-2"

    import sys

    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.main import app

    limiter = getattr(app.state, "limiter", None)
    if limiter is not None:
        setattr(limiter, "enabled", False)

    with TestClient(app) as client:
        token_resp = client.post(
            "/api/auth/token",
            data={"username": "onto_admin2", "password": "onto_password2"},
        )
        assert token_resp.status_code == 200, token_resp.text
        token = token_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        response = client.post(
            "/api/ontology/validate",
            json={"ontology_path": "ontology_dirty_invalid.yaml"},
            headers=headers,
        )
        assert response.status_code == 422, response.text
        detail = response.json().get("detail", {})
        assert detail.get("error") == "ONTOLOGY_VALIDATION_ERROR"
