from __future__ import annotations

import re

from fastapi import APIRouter
from pydantic import BaseModel, Field, field_validator

from .store import get_workspace_store

router = APIRouter()

_VALID_SECTORS = frozenset({"manufacturing", "retail", "healthcare", "finance"})
_TAG_RE = re.compile(r"<[^>]+>")


class WorkspaceSettings(BaseModel):
    name: str | None
    sector_id: str | None


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    sector_id: str | None = Field(default=None, max_length=64)

    @field_validator("name")
    @classmethod
    def sanitize_name(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = _TAG_RE.sub("", v).strip()
        return v[:200] if v else None

    @field_validator("sector_id")
    @classmethod
    def validate_sector(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v not in _VALID_SECTORS:
            return None
        return v


@router.get("/api/workspace", response_model=WorkspaceSettings)
def get_workspace() -> WorkspaceSettings:
    store = get_workspace_store()
    return WorkspaceSettings(name=store.get_name(), sector_id=store.get_sector())


@router.put("/api/workspace", response_model=WorkspaceSettings)
def update_workspace(body: WorkspaceUpdate) -> WorkspaceSettings:
    store = get_workspace_store()
    store.update(name=body.name, sector_id=body.sector_id)
    return WorkspaceSettings(name=store.get_name(), sector_id=store.get_sector())
