"""REST endpoints for API token management."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, status
from pydantic import BaseModel, Field, field_validator

from .store import ApiTokenRecord, get_tokens_store

router = APIRouter(prefix="/api/tokens", tags=["tokens"])

_VALID_SCOPES: frozenset[str] = frozenset(
    {
        "read:ontology",
        "write:ontology",
        "read:agents",
        "write:agents",
        "read:metrics",
        "admin",
    }
)


class TokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    scopes: list[str] = Field(default_factory=lambda: ["read:ontology"])

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        return v.strip()

    @field_validator("scopes")
    @classmethod
    def validate_scopes(cls, v: list[str]) -> list[str]:
        cleaned = [s for s in v if s in _VALID_SCOPES]
        if not cleaned:
            raise ValueError("at least one valid scope is required")
        return cleaned


def _record_dict(r: ApiTokenRecord) -> dict:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    try:
        exp = datetime.fromisoformat(r.expires_at)
        days_left = (exp - now).days
        token_status = "expiring" if 0 < days_left <= 7 else "active"
    except (ValueError, TypeError):
        days_left = -1
        token_status = "active"

    return {
        "id": r.id,
        "name": r.name,
        "scopes": r.scopes,
        "token_preview": r.token_preview,
        "created_at": r.created_at,
        "expires_at": r.expires_at,
        "last_used_at": r.last_used_at,
        "status": token_status,
        "days_left": days_left,
    }


@router.get("")
def list_tokens() -> list[dict]:
    return [_record_dict(r) for r in get_tokens_store().list_tokens()]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_token(body: TokenCreate) -> dict:
    record, plaintext = get_tokens_store().generate(body.name, body.scopes)
    result = _record_dict(record)
    result["full_token"] = plaintext  # exposed exactly once
    return result


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_token(token_id: Annotated[str, Path(max_length=64)]) -> None:
    ok = get_tokens_store().revoke(token_id)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Token not found"
        )
