"""Curation API router — report, human decisions, re-runs, workspace skills,
and the LLM advisory as a background job.

Extracted from main.py (same paths, same auth, same response shapes except
/advise, which became asynchronous: POST starts a job, GET /advise/status
polls it). main.py owns the semantic state; everything the endpoints need
from it is injected through ``build_curation_router``.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Any, Callable, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class CurationDecisionRequest(BaseModel):
    table: str = Field(min_length=1, max_length=256)
    status: Literal["kept", "excluded"]
    reason: str = Field(default="", max_length=500)


class CurationSkillsRequest(BaseModel):
    content: str = Field(max_length=100_000)


class CurationAdviseRequest(BaseModel):
    force: bool = Field(
        default=False,
        description="Re-ask tables on low-confidence cooldown too",
    )


# One advisory job at a time, process-wide: the advisor holds an LLM call up
# to ~30 s and a second concurrent run would just re-judge the same tables.
_JOB_LOCK = threading.Lock()
_job: dict[str, Any] = {"status": "idle"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_curation_router(
    *,
    user_dependency: Callable[..., Any],
    admin_dependency: Callable[..., Any],
    ensure_semantic_loaded: Callable[[], None],
    curation_refresh: Callable[[], None],
    get_schema_tables: Callable[[], set[str] | None],
    get_advise_inputs: Callable[[], tuple[dict, list[dict], list[str]]],
    make_submit_merge: Callable[[str], Callable[[str, str], str]],
    audit: Callable[..., None],
) -> APIRouter:
    """``get_advise_inputs`` returns (schema, entities, context_docs);
    ``make_submit_merge(username)`` returns the merge-queue submitter;
    ``audit(request, user, action, detail, category=...)`` matches main._audit
    (request may be None from the background thread)."""
    router = APIRouter(prefix="/api/curation", tags=["curation"])

    @router.get("/report")
    def get_curation_report(
        _user: Any = Depends(user_dependency),
    ) -> dict[str, Any]:
        """Why each table is (not) in the model: kept / excluded / uncertain,
        each with the rule or signal that decided it. Decisions are reversible
        via POST /api/curation/decision."""
        from .engine import curation_report  # noqa: PLC0415

        ensure_semantic_loaded()
        return curation_report(schema_tables=get_schema_tables())

    @router.post("/decision")
    def set_curation_decision(
        request: Request,
        body: CurationDecisionRequest,
        current_user: Any = Depends(user_dependency),
    ) -> dict[str, Any]:
        """Pin a human decision on a table (engine runs never overwrite it).
        Excluding hides the table from the semantic surface; re-keeping
        restores it — nothing is ever deleted."""
        from .store import get_curation_store  # noqa: PLC0415

        record = get_curation_store().set_decision(
            body.table,
            body.status,
            body.reason or f"user:{current_user.username}",
            decided_by="user",
        )
        curation_refresh()
        audit(
            request,
            current_user,
            "Curation decision",
            f"{body.table} → {body.status}",
            category="config",
        )
        return {"table": body.table, **record}

    @router.post("/run")
    def run_curation_now(
        request: Request,
        current_user: Any = Depends(user_dependency),
    ) -> dict[str, Any]:
        """Force a curation re-run (e.g. after editing the workspace pack)."""
        from .engine import curation_report  # noqa: PLC0415

        ensure_semantic_loaded()
        curation_refresh()
        audit(request, current_user, "Curation run", "manual re-run", category="config")
        return curation_report()

    # ── LLM advisory as a background job ─────────────────────────────────────

    def _run_advise_job(principal: Any, force: bool) -> None:
        from .llm_advisor import advise  # noqa: PLC0415
        from .store import get_curation_store  # noqa: PLC0415

        try:
            ensure_semantic_loaded()
            schema, entities, context_docs = get_advise_inputs()
            result = advise(
                schema,
                entities,
                context_docs,
                get_curation_store(),
                make_submit_merge(principal.username),
                force=force,
            )
            if result.get("applied"):
                curation_refresh()
            audit(
                None,
                principal,
                "Curation LLM advisory",
                f"{len(result.get('applied', []))} decisions, "
                f"{len(result.get('merge_proposals', []))} merge proposals",
                category="config",
            )
            with _JOB_LOCK:
                _job.update(status="done", result=result, finished_at=_now())
        except Exception as exc:  # noqa: BLE001 — surfaced via the status poll
            logger.warning("curation advisory job failed: %s", exc)
            with _JOB_LOCK:
                _job.update(
                    status="error",
                    error=f"LLM advisory failed: {exc}"[:500],
                    finished_at=_now(),
                )

    @router.post("/advise", status_code=202)
    def start_curation_advisor(
        body: CurationAdviseRequest | None = None,
        current_user: Any = Depends(admin_dependency),
    ) -> dict[str, Any]:
        """Start one LLM advisory pass over the *uncertain* tables as a
        background job (the LLM call can take ~30 s — it must not hold an API
        worker thread). Poll GET /api/curation/advise/status for the outcome.

        keep/exclude verdicts are applied as reversible curation decisions
        (provenance ``llm`` — a user pin always beats them); merge proposals
        are queued as MERGE_ENTITIES actions in the human-approval queue,
        never executed directly. Requires an LLM provider key; 503 otherwise.
        409 when a job is already running.
        """
        from .llm_advisor import llm_available  # noqa: PLC0415

        if not llm_available():
            raise HTTPException(
                status_code=503,
                detail=(
                    "No LLM provider configured (set ANTHROPIC_API_KEY or "
                    "GROQ_API_KEY) — the deterministic curation tiers "
                    "remain active"
                ),
            )
        force = bool(body.force) if body else False
        with _JOB_LOCK:
            if _job.get("status") == "running":
                raise HTTPException(
                    status_code=409, detail="An advisory run is already in progress"
                )
            _job.clear()
            _job.update(
                status="running",
                started_at=_now(),
                started_by=current_user.username,
                force=force,
            )
        threading.Thread(
            target=_run_advise_job,
            args=(current_user, force),
            name="curation-advise",
            daemon=True,
        ).start()
        return {"status": "running", "started_at": _job["started_at"]}

    @router.get("/advise/status")
    def get_curation_advisor_status(
        _user: Any = Depends(admin_dependency),
    ) -> dict[str, Any]:
        """State of the last advisory job: idle | running | done | error.
        ``result`` carries the advisor summary once done."""
        with _JOB_LOCK:
            return dict(_job)

    # ── Workspace skill pack ──────────────────────────────────────────────────

    @router.get("/skills")
    def get_curation_skills(
        _user: Any = Depends(admin_dependency),
    ) -> dict[str, Any]:
        """The workspace skill pack (editable YAML): keep/exclude rules and
        concept aliases applied on top of the built-in packs."""
        from .engine import workspace_pack_path  # noqa: PLC0415

        path = workspace_pack_path()
        try:
            content = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            content = (
                "# Workspace curation skill pack — rules and aliases for THIS "
                "workspace.\n"
                "pack: workspace\nversion: 1\n\n"
                '# exclude:\n#   - id: my-rule\n#     pattern: ".*_scratch$"\n\n'
                "# keep: []\n\n"
                "# aliases:\n#   Customer: [paziente, pazienti]\n"
            )
        return {"path": path.name, "content": content}

    @router.put("/skills")
    def put_curation_skills(
        request: Request,
        body: CurationSkillsRequest,
        current_user: Any = Depends(admin_dependency),
    ) -> dict[str, Any]:
        """Save the workspace skill pack, then re-run curation with it."""
        import yaml as _yaml  # noqa: PLC0415

        from .engine import workspace_pack_path  # noqa: PLC0415

        try:
            parsed = _yaml.safe_load(body.content) or {}
            if not isinstance(parsed, dict):
                raise ValueError("pack must be a YAML mapping")
        except Exception as exc:  # noqa: BLE001 — reject broken YAML with a 400
            raise HTTPException(status_code=400, detail=f"Invalid YAML: {exc}")

        workspace_pack_path().write_text(body.content, encoding="utf-8")
        ensure_semantic_loaded()
        curation_refresh()
        audit(
            request,
            current_user,
            "Curation skills updated",
            "workspace pack saved",
            category="config",
        )
        return {"saved": True}

    return router
