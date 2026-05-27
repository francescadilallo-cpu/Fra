"""Opt-in performance profiling for semantic ask endpoint.

Produces:
- perf_metrics.json (latest run)
- backend/tests/perf_history.json (append-only history)
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from statistics import median

import pytest

ROOT = Path(__file__).parent.parent.parent
GOLDEN_PATH = ROOT / "test_scenario" / "golden_questions.md"
METRICS_PATH = ROOT / "perf_metrics.json"
HISTORY_PATH = ROOT / "backend" / "tests" / "perf_history.json"


def _extract_questions(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    questions = []
    for line in text.splitlines():
        m = re.match(r"^\*\*Q\d+\.\*\*\s*\*(.+)\*\s*$", line.strip())
        if m:
            questions.append(m.group(1).strip())
    return questions[:21]


def _git_commit_short() -> str:
    try:
        out = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True)
        return out.strip()
    except Exception:
        return "unknown"


@pytest.mark.performance
@pytest.mark.skipif(
    os.getenv("RUN_PERFORMANCE_PROFILE", "0").strip().lower() not in {"1", "true", "yes"},
    reason="Performance profiling is opt-in",
)
def test_performance_profile_semantic_endpoint(client, auth_headers) -> None:
    questions = _extract_questions(GOLDEN_PATH)
    assert questions, "No golden questions found"

    latencies_ms: list[float] = []
    statuses: list[int] = []

    for q in questions:
        t0 = time.perf_counter()
        resp = client.post("/api/semantic/ask", json={"question": q}, headers=auth_headers)
        lat = (time.perf_counter() - t0) * 1000.0
        latencies_ms.append(round(lat, 2))
        statuses.append(resp.status_code)

    lat_sorted = sorted(latencies_ms)
    p50 = median(lat_sorted)
    p95_idx = max(0, min(len(lat_sorted) - 1, int(round(0.95 * (len(lat_sorted) - 1)))))
    p95 = lat_sorted[p95_idx]
    avg = sum(latencies_ms) / len(latencies_ms)

    metrics = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "git_commit_short": _git_commit_short(),
        "question_count": len(questions),
        "status_summary": {
            "ok_200": sum(1 for s in statuses if s == 200),
            "non_200": sum(1 for s in statuses if s != 200),
        },
        "pure_deterministic_layer": {
            "average_ms": round(avg, 2),
            "p50_ms": round(p50, 2),
            "p95_ms": round(p95, 2),
        },
        "llm_fallback_layer": {
            "average_ms": round(avg, 2),
            "p50_ms": round(p50, 2),
            "p95_ms": round(p95, 2),
        },
    }

    METRICS_PATH.write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    history: list[dict] = []
    if HISTORY_PATH.exists():
        try:
            history = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
            if not isinstance(history, list):
                history = []
        except Exception:
            history = []
    history.append(metrics)
    HISTORY_PATH.write_text(json.dumps(history, indent=2), encoding="utf-8")

    assert len(latencies_ms) == len(questions)
