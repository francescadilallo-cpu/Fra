from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .store import get_workspace_store

router = APIRouter()


class WorkspaceSettings(BaseModel):
    name: str | None
    sector_id: str | None


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    sector_id: str | None = Field(default=None, max_length=64)


@router.get("/api/workspace", response_model=WorkspaceSettings)
def get_workspace() -> WorkspaceSettings:
    store = get_workspace_store()
    return WorkspaceSettings(name=store.get_name(), sector_id=store.get_sector())


@router.put("/api/workspace", response_model=WorkspaceSettings)
def update_workspace(body: WorkspaceUpdate) -> WorkspaceSettings:
    store = get_workspace_store()
    store.update(name=body.name, sector_id=body.sector_id)
    return WorkspaceSettings(name=store.get_name(), sector_id=store.get_sector())
