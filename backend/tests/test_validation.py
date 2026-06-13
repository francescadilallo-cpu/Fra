"""Tests for input validation on users, notifications, and workspace routers."""

import pytest
from pydantic import ValidationError

from backend.app.users.router import InviteRequest, RoleUpdateRequest
from backend.app.notifications.router import RoutingUpdate
from backend.app.workspace.router import WorkspaceUpdate


# ── Users: email validation ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    "email",
    [
        "alice@example.com",
        "user.name+tag@sub.domain.org",
        "test@company.io",
    ],
)
def test_valid_emails_accepted(email: str) -> None:
    r = InviteRequest(email=email, role="editor")
    assert r.email == email


@pytest.mark.parametrize(
    "email",
    [
        "not-an-email",
        "missing-at-sign.com",
        "@nodomain.com",
        "a@",
        "",
        "x" * 201,
    ],
)
def test_invalid_emails_rejected(email: str) -> None:
    with pytest.raises(ValidationError):
        InviteRequest(email=email, role="editor")


def test_invalid_role_rejected() -> None:
    with pytest.raises(ValidationError):
        InviteRequest(email="a@b.com", role="superuser")


def test_role_update_invalid() -> None:
    with pytest.raises(ValidationError):
        RoleUpdateRequest(role="god")


# ── Notifications: routing list size limit ────────────────────────────────────


def test_routing_update_within_limit() -> None:
    ids = [f"chan-{i}" for i in range(10)]
    r = RoutingUpdate(critical=ids, warning=[], info=[])
    assert len(r.critical) == 10


def test_routing_update_too_many_ids() -> None:
    ids = [f"chan-{i}" for i in range(51)]
    with pytest.raises(ValidationError):
        RoutingUpdate(critical=ids)


def test_routing_ids_truncated_to_64_chars() -> None:
    long_id = "x" * 100
    r = RoutingUpdate(critical=[long_id])
    assert r.critical[0] == "x" * 64


# ── Workspace: name sanitization and sector validation ────────────────────────


def test_workspace_name_strips_html_tags() -> None:
    u = WorkspaceUpdate(name="<script>alert(1)</script>Acme", sector_id=None)
    # Tags are stripped; text content between tags is kept (same as <b>x</b> → x)
    assert u.name == "alert(1)Acme"
    assert "<script>" not in (u.name or "")
    assert "</script>" not in (u.name or "")


def test_workspace_name_strips_plain_tags() -> None:
    u = WorkspaceUpdate(name="<b>Bold</b> Corp", sector_id=None)
    assert u.name == "Bold Corp"


def test_workspace_valid_sector() -> None:
    u = WorkspaceUpdate(name=None, sector_id="retail")
    assert u.sector_id == "retail"


def test_workspace_invalid_sector_becomes_none() -> None:
    u = WorkspaceUpdate(name=None, sector_id="space_travel")
    assert u.sector_id is None


def test_workspace_name_none_stays_none() -> None:
    u = WorkspaceUpdate(name=None, sector_id=None)
    assert u.name is None
