"""REST endpoints for workspace member management."""

from __future__ import annotations

import re

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, status
from pydantic import BaseModel, Field, field_validator

from .store import WorkspaceMember, get_users_store

router = APIRouter(prefix="/api/users", tags=["users"])

_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")


class InviteRequest(BaseModel):
    email: str = Field(max_length=200)
    role: str = "editor"

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip()
        if not v or not _EMAIL_RE.match(v):
            raise ValueError("invalid email address")
        return v

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in {"admin", "editor", "viewer"}:
            raise ValueError("role must be admin, editor, or viewer")
        return v


class RoleUpdateRequest(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in {"admin", "editor", "viewer"}:
            raise ValueError("role must be admin, editor, or viewer")
        return v


def _member_dict(m: WorkspaceMember) -> dict:
    return {
        "id": m.id,
        "username": m.username,
        "email": m.email,
        "role": m.role,
        "status": m.status,
        "created_at": m.created_at,
    }


@router.get("")
def list_users() -> list[dict]:
    return [_member_dict(m) for m in get_users_store().list_members()]


@router.post("", status_code=status.HTTP_201_CREATED)
def invite_user(body: InviteRequest) -> dict:
    member = get_users_store().add_member(email=body.email, role=body.role)
    return _member_dict(member)


@router.patch("/{member_id}/role")
def update_role(
    member_id: Annotated[str, Path(max_length=64)], body: RoleUpdateRequest
) -> dict:
    ok = get_users_store().update_role(member_id, body.role)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Member not found"
        )
    return {"ok": True}


@router.delete("/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_user(member_id: Annotated[str, Path(max_length=64)]) -> None:
    ok = get_users_store().remove_member(member_id)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Member not found"
        )
