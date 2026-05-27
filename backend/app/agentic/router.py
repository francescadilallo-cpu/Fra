from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .executive import (
    AgentActionNotFoundError,
    AgentExecutionError,
    AgentSemanticValidationError,
    ExecutiveAgenticLayer,
    PendingAgentAction,
)


class AgentExecuteRequest(BaseModel):
    command: str = Field(min_length=5, description="Executive command in natural language")


class AgentApproveRequest(BaseModel):
    approve: bool = True
    manager_note: str | None = None


class AgentActionResponse(BaseModel):
    action_id: str
    status: str
    command: str
    requested_by: str
    requested_role: str
    validation_checks: list[str]
    manager_note: str | None = None
    created_at: str
    updated_at: str
    proposed_action: dict[str, Any]


class AgentAuditListResponse(BaseModel):
    records: list[dict[str, Any]]


def _to_response(action: PendingAgentAction) -> AgentActionResponse:
    return AgentActionResponse(
        action_id=action.action_id,
        status=action.status,
        command=action.command,
        requested_by=action.requested_by,
        requested_role=action.requested_role,
        validation_checks=list(action.validation_checks),
        manager_note=action.manager_note,
        created_at=action.created_at,
        updated_at=action.updated_at,
        proposed_action=action.proposed_action.model_dump(mode="json"),
    )


def build_agent_router(
    layer: ExecutiveAgenticLayer,
    admin_dependency: Callable[..., Any],
) -> APIRouter:
    router = APIRouter(prefix="/api/agent", tags=["Executive Agentic Layer"])

    @router.post("/execute", response_model=AgentActionResponse)
    def execute_command(
        req: AgentExecuteRequest,
        current_user: Any = Depends(admin_dependency),
    ) -> AgentActionResponse:
        try:
            action = layer.submit_command(
                command=req.command,
                actor=getattr(current_user, "username", "unknown"),
                actor_role=getattr(current_user, "role", "unknown"),
            )
            return _to_response(action)
        except AgentSemanticValidationError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "error": "AGENT_VALIDATION_FAILED",
                    "message": str(exc),
                },
            ) from exc

    @router.post("/approve/{action_id}", response_model=AgentActionResponse)
    def approve_action(
        action_id: str,
        req: AgentApproveRequest,
        current_user: Any = Depends(admin_dependency),
    ) -> AgentActionResponse:
        try:
            action = layer.approve_action(
                action_id=action_id,
                actor=getattr(current_user, "username", "unknown"),
                actor_role=getattr(current_user, "role", "unknown"),
                approve=req.approve,
                manager_note=req.manager_note,
            )
            return _to_response(action)
        except AgentActionNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"error": "AGENT_ACTION_NOT_FOUND", "message": str(exc)},
            ) from exc
        except AgentExecutionError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "AGENT_ACTION_EXECUTION_FAILED", "message": str(exc)},
            ) from exc

    @router.get("/audit", response_model=AgentAuditListResponse)
    def list_audit(
        limit: int = 200,
        _: Any = Depends(admin_dependency),
    ) -> AgentAuditListResponse:
        records = [r.model_dump(mode="json") for r in layer.get_audit_log(limit=limit)]
        return AgentAuditListResponse(records=records)

    return router
