"""Audit API router — read-only access to the append-only audit trail.

Auth is applied by main.py at include time (same pattern as the context
router) to avoid a circular import on require_roles.
"""

from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel

from .store import get_audit_store

router = APIRouter(prefix="/api/audit", tags=["audit"])


class AuditEntryOut(BaseModel):
    id: int
    ts: str
    username: str
    action: str
    resource: str
    ip: str
    category: str


@router.get("", response_model=list[AuditEntryOut])
def list_audit(
    limit: int = Query(200, ge=1, le=1000),
    category: str | None = Query(None),
    q: str | None = Query(None, max_length=120),
) -> list[AuditEntryOut]:
    entries = get_audit_store().list(limit=limit, category=category, q=q)
    return [AuditEntryOut(**e.__dict__) for e in entries]
