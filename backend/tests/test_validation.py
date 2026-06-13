"""Tests for input validation on users, notifications, and workspace routers."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.users.router import InviteRequest, RoleUpdateRequest
from app.notifications.router import ChannelCreate, ChannelUpdate, RoutingUpdate
from app.tokens.router import TokenCreate
from app.workspace.router import WorkspaceUpdate


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


# ── Notifications: channel create validation ─────────────────────────────────


def test_channel_create_valid() -> None:
    c = ChannelCreate(name="ops-alerts", channel_type="slack", destination="#alerts")
    assert c.name == "ops-alerts"
    assert c.channel_type == "slack"


def test_channel_create_invalid_type() -> None:
    with pytest.raises(ValidationError):
        ChannelCreate(name="x", channel_type="telegram", destination="#x")


def test_channel_create_empty_name() -> None:
    with pytest.raises(ValidationError):
        ChannelCreate(name="", channel_type="email", destination="ops@x.com")


def test_channel_create_empty_destination() -> None:
    with pytest.raises(ValidationError):
        ChannelCreate(name="valid", channel_type="webhook", destination="")


def test_channel_create_destination_too_long() -> None:
    with pytest.raises(ValidationError):
        ChannelCreate(name="x", channel_type="webhook", destination="h" * 501)


# ── Notifications: channel update name length ────────────────────────────────


def test_channel_update_name_within_limit() -> None:
    u = ChannelUpdate(name="My Channel", enabled=True)
    assert u.name == "My Channel"


def test_channel_update_name_too_long() -> None:
    with pytest.raises(ValidationError):
        ChannelUpdate(name="x" * 101)


def test_channel_update_name_none_allowed() -> None:
    u = ChannelUpdate(enabled=False)
    assert u.name is None


def test_channel_update_blank_name_rejected() -> None:
    with pytest.raises(ValidationError):
        ChannelUpdate(name="   ")


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


# ── Tokens: name and scope validation ────────────────────────────────────────


def test_token_create_valid() -> None:
    t = TokenCreate(name="CI pipeline", scopes=["read:ontology"])
    assert t.name == "CI pipeline"
    assert t.scopes == ["read:ontology"]


def test_token_create_default_scopes() -> None:
    t = TokenCreate(name="my-token")
    assert t.scopes == ["read:ontology"]


def test_token_create_name_too_long() -> None:
    with pytest.raises(ValidationError):
        TokenCreate(name="x" * 101, scopes=["read:ontology"])


def test_token_create_empty_name() -> None:
    with pytest.raises(ValidationError):
        TokenCreate(name="", scopes=["read:ontology"])


def test_token_create_invalid_scope_rejected() -> None:
    with pytest.raises(ValidationError):
        TokenCreate(name="tok", scopes=["invalid:scope"])


def test_token_create_mixed_scopes_filters_invalid() -> None:
    t = TokenCreate(name="tok", scopes=["read:ontology", "bad:scope", "admin"])
    assert "bad:scope" not in t.scopes
    assert set(t.scopes) == {"read:ontology", "admin"}


def test_token_create_whitespace_name_stripped() -> None:
    t = TokenCreate(name="  my token  ", scopes=["read:ontology"])
    assert t.name == "my token"
