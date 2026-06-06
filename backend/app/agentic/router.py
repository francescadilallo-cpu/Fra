from __future__ import annotations

import logging
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

logger = logging.getLogger(__name__)


class AgentExecuteRequest(BaseModel):
    command: str = Field(
        min_length=5, description="Executive command in natural language"
    )


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
    resync_result: dict[str, Any] | None = None


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
        resync_result=action.resync_result.model_dump(mode="json")
        if action.resync_result
        else None,
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
        actor = getattr(current_user, "username", "unknown")
        logger.info("agent.execute command=%r actor=%s", req.command[:80], actor)
        try:
            action = layer.submit_command(
                command=req.command,
                actor=actor,
                actor_role=getattr(current_user, "role", "unknown"),
            )
            logger.info(
                "agent.execute action_id=%s status=%s", action.action_id, action.status
            )
            return _to_response(action)
        except AgentSemanticValidationError as exc:
            logger.warning("agent.execute validation_failed actor=%s: %s", actor, exc)
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
        actor = getattr(current_user, "username", "unknown")
        decision = "APPROVE" if req.approve else "REJECT"
        logger.info(
            "agent.approve action_id=%s decision=%s actor=%s",
            action_id,
            decision,
            actor,
        )
        try:
            action = layer.approve_action(
                action_id=action_id,
                actor=actor,
                actor_role=getattr(current_user, "role", "unknown"),
                approve=req.approve,
                manager_note=req.manager_note,
            )
            logger.info(
                "agent.approve action_id=%s final_status=%s", action_id, action.status
            )
            return _to_response(action)
        except AgentActionNotFoundError as exc:
            logger.warning("agent.approve not_found action_id=%s", action_id)
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"error": "AGENT_ACTION_NOT_FOUND", "message": str(exc)},
            ) from exc
        except AgentExecutionError as exc:
            logger.error(
                "agent.approve execution_failed action_id=%s: %s", action_id, exc
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "AGENT_ACTION_EXECUTION_FAILED", "message": str(exc)},
            ) from exc

    @router.get("/list", response_model=list[AgentActionResponse])
    def list_actions(
        status: str | None = None,
        limit: int = 50,
        _: Any = Depends(admin_dependency),
    ) -> list[AgentActionResponse]:
        actions = layer.list_actions(status_filter=status, limit=limit)
        logger.debug("agent.list status_filter=%s count=%d", status, len(actions))
        return [_to_response(a) for a in actions]

    @router.get("/status/{action_id}", response_model=AgentActionResponse)
    def get_action_status(
        action_id: str,
        _: Any = Depends(admin_dependency),
    ) -> AgentActionResponse:
        with layer._lock:
            action = layer._pending_actions.get(action_id)
        if not action:
            logger.debug("agent.status not_found action_id=%s", action_id)
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "error": "AGENT_ACTION_NOT_FOUND",
                    "message": f"Action '{action_id}' not found",
                },
            )
        return _to_response(action)

    @router.get("/audit", response_model=AgentAuditListResponse)
    def list_audit(
        limit: int = 200,
        _: Any = Depends(admin_dependency),
    ) -> AgentAuditListResponse:
        records = [r.model_dump(mode="json") for r in layer.get_audit_log(limit=limit)]
        logger.debug("agent.audit returned %d records", len(records))
        return AgentAuditListResponse(records=records)

    return router
