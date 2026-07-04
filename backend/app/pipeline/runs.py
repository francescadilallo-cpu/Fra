"""PipelineRun model + thread-safe in-process run store.

A *run* is one execution of the auto-build pipeline. It carries an ordered list
of stages, each with its own state, so the frontend can poll a single endpoint
and render live progress. State is in-process only (like
``context/manager.py::ContextManager``) — a run does not need to survive a
restart; the *result* (KG + Semantic Layer) is persisted by the build itself.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

# ── Stage identifiers (map 1:1 to the user-facing 5-step flow) ────────────────
STAGE_CONTEXT = "context"
STAGE_SOURCES = "sources"
STAGE_BUILD = "build"
STAGE_INTEGRATION = "integration"
STAGE_VERIFICATION = "verification"

STAGE_SEQUENCE: list[str] = [
    STAGE_CONTEXT,
    STAGE_SOURCES,
    STAGE_BUILD,
    STAGE_INTEGRATION,
    STAGE_VERIFICATION,
]

StageState = Literal["pending", "running", "done", "error", "skipped"]


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class StageStatus:
    """State of a single pipeline stage."""

    name: str
    state: StageState = "pending"
    detail: str = ""
    started_at: str | None = None
    finished_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PipelineRun:
    """One execution of the auto-build pipeline."""

    id: str = field(default_factory=lambda: f"run-{uuid.uuid4().hex[:12]}")
    stages: list[StageStatus] = field(
        default_factory=lambda: [StageStatus(name=n) for n in STAGE_SEQUENCE]
    )
    started_at: str = field(default_factory=_utcnow)
    finished_at: str | None = None
    ok: bool = False
    # Verification report (stage 5) and applied-counts summary (stage 3).
    report: dict[str, Any] = field(default_factory=dict)
    # monotonic timestamp for eviction; not serialised
    _touched: float = field(default_factory=time.monotonic, repr=False)

    # ── Mutators (used by the orchestrator) ──────────────────────────────────
    def _stage(self, name: str) -> StageStatus:
        for s in self.stages:
            if s.name == name:
                return s
        raise KeyError(f"Unknown stage '{name}'")

    def start(self, name: str, detail: str = "") -> None:
        s = self._stage(name)
        s.state = "running"
        s.started_at = _utcnow()
        if detail:
            s.detail = detail

    def finish(self, name: str, detail: str = "") -> None:
        s = self._stage(name)
        s.state = "done"
        s.finished_at = _utcnow()
        if detail:
            s.detail = detail

    def fail(self, name: str, detail: str = "") -> None:
        s = self._stage(name)
        s.state = "error"
        s.finished_at = _utcnow()
        s.detail = detail

    def skip(self, name: str, detail: str = "") -> None:
        s = self._stage(name)
        s.state = "skipped"
        s.finished_at = _utcnow()
        s.detail = detail

    def complete(self) -> None:
        self.finished_at = _utcnow()
        # The run is "ok" if no stage hard-errored.
        self.ok = all(s.state != "error" for s in self.stages)

    @property
    def running(self) -> bool:
        return self.finished_at is None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "stages": [s.to_dict() for s in self.stages],
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "ok": self.ok,
            "running": self.running,
            "report": self.report,
        }


class PipelineRunStore:
    """Thread-safe store for the current/most-recent pipeline run."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._current: PipelineRun | None = None

    def new_run(self) -> PipelineRun:
        run = PipelineRun()
        with self._lock:
            self._current = run
        return run

    def begin_run(self) -> PipelineRun | None:
        """Atomically reserve a new run, or return None if one is in progress.

        Closes the check-then-act race the endpoint would otherwise have between
        ``is_running()`` and starting the work: the guard and the reservation
        happen under a single lock acquisition.
        """
        with self._lock:
            if self._current is not None and self._current.running:
                return None
            run = PipelineRun()
            self._current = run
            return run

    def set_current(self, run: PipelineRun) -> None:
        with self._lock:
            self._current = run

    def current_or_last(self) -> PipelineRun | None:
        with self._lock:
            return self._current

    def is_running(self) -> bool:
        with self._lock:
            return self._current is not None and self._current.running


# Process-wide singleton (mirrors other module-level default stores).
default_run_store = PipelineRunStore()
