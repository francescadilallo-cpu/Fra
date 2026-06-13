"""REST endpoints for notification channels and severity routing."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from .store import Channel, get_notifications_store

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class ChannelCreate(BaseModel):
    name: str
    channel_type: str
    destination: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v[:100]

    @field_validator("channel_type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in {"slack", "email", "teams", "webhook"}:
            raise ValueError("channel_type must be slack, email, teams, or webhook")
        return v

    @field_validator("destination")
    @classmethod
    def validate_dest(cls, v: str) -> str:
        return v.strip()[:500]


class ChannelUpdate(BaseModel):
    enabled: bool | None = None
    name: str | None = Field(default=None, max_length=100)


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
    ch = get_notifications_store().add_channel(
        body.name, body.channel_type, body.destination
    )
    return _channel_dict(ch)


@router.patch("/channels/{channel_id}")
def update_channel(channel_id: str, body: ChannelUpdate) -> dict:
    ok = get_notifications_store().update_channel(
        channel_id, enabled=body.enabled, name=body.name
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found"
        )
    return {"ok": True}


@router.delete("/channels/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_channel(channel_id: str) -> None:
    ok = get_notifications_store().remove_channel(channel_id)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found"
        )


@router.get("/routing")
def get_routing() -> dict:
    return get_notifications_store().get_routing()


@router.put("/routing")
def update_routing(body: RoutingUpdate) -> dict:
    get_notifications_store().update_routing(
        {"critical": body.critical, "warning": body.warning, "info": body.info}
    )
    return {"ok": True}
