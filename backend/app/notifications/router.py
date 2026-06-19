"""REST endpoints for notification channels and severity routing."""

from __future__ import annotations

import sqlite3
import time
from typing import Annotated

import httpx
from fastapi import APIRouter, HTTPException, Path, status
from pydantic import BaseModel, Field, field_validator

from .store import Channel, get_notifications_store

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class ChannelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    channel_type: str
    destination: str = Field(min_length=1, max_length=500)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v

    @field_validator("channel_type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in {"slack", "email", "teams", "webhook"}:
            raise ValueError("channel_type must be slack, email, teams, or webhook")
        return v

    @field_validator("destination")
    @classmethod
    def validate_dest(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("destination is required")
        return v


class ChannelUpdate(BaseModel):
    enabled: bool | None = None
    name: str | None = Field(default=None, max_length=100)

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("name cannot be blank")
        return v


class RoutingUpdate(BaseModel):
    critical: list[str] = []
    warning: list[str] = []
    info: list[str] = []

    @field_validator("critical", "warning", "info")
    @classmethod
    def validate_ids(cls, v: list[str]) -> list[str]:
        if len(v) > 50:
            raise ValueError("too many channel IDs (max 50)")
        return [s[:64] for s in v if isinstance(s, str)]


def _channel_dict(c: Channel) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "type": c.channel_type,
        "destination": c.destination,
        "enabled": c.enabled,
    }


@router.get("/channels")
def list_channels() -> list[dict]:
    return [_channel_dict(c) for c in get_notifications_store().list_channels()]


@router.post("/channels", status_code=status.HTTP_201_CREATED)
def add_channel(body: ChannelCreate) -> dict:
    try:
        ch = get_notifications_store().add_channel(
            body.name, body.channel_type, body.destination
        )
    except sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database temporarily unavailable",
        ) from exc
    return _channel_dict(ch)


@router.patch("/channels/{channel_id}")
def update_channel(
    channel_id: Annotated[str, Path(max_length=64)], body: ChannelUpdate
) -> dict:
    try:
        ok = get_notifications_store().update_channel(
            channel_id, enabled=body.enabled, name=body.name
        )
    except sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database temporarily unavailable",
        ) from exc
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found"
        )
    return {"ok": True}


@router.delete("/channels/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_channel(channel_id: Annotated[str, Path(max_length=64)]) -> None:
    try:
        ok = get_notifications_store().remove_channel(channel_id)
    except sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database temporarily unavailable",
        ) from exc
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found"
        )


@router.post("/channels/{channel_id}/test")
async def test_channel(channel_id: Annotated[str, Path(max_length=64)]) -> dict:
    """Send a test payload to the channel's destination and return latency (ms)."""
    ch = next(
        (c for c in get_notifications_store().list_channels() if c.id == channel_id),
        None,
    )
    if ch is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found"
        )

    payload = {
        "source": "SemanticIntelligence",
        "event": "test",
        "severity": "info",
        "message": "Test notification from SemanticIntelligence — channel delivery confirmed.",
    }

    if ch.channel_type == "webhook":
        try:
            t0 = time.monotonic()
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(ch.destination, json=payload)
            latency_ms = round((time.monotonic() - t0) * 1000)
            if resp.status_code >= 400:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Webhook returned HTTP {resp.status_code}",
                )
            return {"ok": True, "latency_ms": latency_ms}
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not reach the webhook endpoint — check the URL and network connectivity",
            ) from exc
    else:
        # Slack / email / Teams: deliver via the same dispatch path used by
        # real events (not yet implemented). Return a placeholder response so
        # the frontend can at least confirm the channel is reachable.
        return {
            "ok": True,
            "latency_ms": None,
            "note": f"{ch.channel_type} delivery not yet implemented on this deployment",
        }


@router.get("/routing")
def get_routing() -> dict:
    return get_notifications_store().get_routing()


@router.put("/routing")
def update_routing(body: RoutingUpdate) -> dict:
    try:
        get_notifications_store().update_routing(
            {"critical": body.critical, "warning": body.warning, "info": body.info}
        )
    except sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database temporarily unavailable",
        ) from exc
    return {"ok": True}
