"""Auto-build pipeline: Context → Sources → KG/Semantic Layer → Integration → Verification.

Orchestrates the existing building blocks (document context analysis, source
profiling, model proposal+apply, semantic build, template generation) into a
single server-side run with per-stage status, so the platform assembles the
Knowledge Graph and Semantic Layer automatically from documents + data sources.
"""

from .runs import PipelineRun, PipelineRunStore, StageStatus, default_run_store

__all__ = [
    "PipelineRun",
    "PipelineRunStore",
    "StageStatus",
    "default_run_store",
]
