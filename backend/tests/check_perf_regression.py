from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
METRICS_PATH = ROOT / "perf_metrics.json"
HISTORY_PATH = ROOT / "backend" / "tests" / "perf_history.json"


def _load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _extract_block(payload: dict) -> dict:
    return payload.get("pure_deterministic_layer", {})


def _summary_line(label: str, latest: float, reference: float, limit: float, status: str) -> str:
    delta = ((latest - reference) / reference * 100.0) if reference > 0 else 0.0
    return f"| {label} | {latest:.2f} | {reference:.2f} | {delta:+.2f}% | {limit:.2f} | {status} |"


def main() -> int:
    if not METRICS_PATH.exists():
        print("No perf_metrics.json found. Skipping regression gate.")
        return 0

    latest_payload = _load_json(METRICS_PATH)
    latest = _extract_block(latest_payload)

    baseline = {"average_ms": 15.0, "p50_ms": 15.0, "p95_ms": 15.0}
    reference = baseline

    if HISTORY_PATH.exists():
        try:
            hist = _load_json(HISTORY_PATH)
            if isinstance(hist, list) and len(hist) >= 2:
                reference = _extract_block(hist[-2])
        except Exception:
            pass

    avg_latest = float(latest.get("average_ms", 0.0))
    p50_latest = float(latest.get("p50_ms", 0.0))
    p95_latest = float(latest.get("p95_ms", 0.0))

    avg_ref = float(reference.get("average_ms", 15.0))
    p50_ref = float(reference.get("p50_ms", 15.0))
    p95_ref = float(reference.get("p95_ms", 15.0))

    threshold = 1.20
    avg_limit = avg_ref * threshold
    p50_limit = p50_ref * threshold
    p95_limit = p95_ref * threshold

    avg_warn = avg_latest > avg_limit
    p50_warn = p50_latest > p50_limit
    p95_fail = p95_latest > p95_limit

    if avg_warn or p50_warn:
        print("PERFORMANCE WARNING: average/p50 above threshold")

    if p95_fail:
        print("PERFORMANCE REGRESSION DETECTED: p95 above threshold")

    summary_path = os.getenv("GITHUB_STEP_SUMMARY", "")
    if summary_path:
        lines = [
            "## Performance Regression Gate",
            "",
            "| Metric | Latest | Reference | Delta | Allowed Max | Status |",
            "|---|---:|---:|---:|---:|---|",
            _summary_line("average_ms", avg_latest, avg_ref, avg_limit, "WARN" if avg_warn else "OK"),
            _summary_line("p50_ms", p50_latest, p50_ref, p50_limit, "WARN" if p50_warn else "OK"),
            _summary_line("p95_ms", p95_latest, p95_ref, p95_limit, "FAIL" if p95_fail else "OK"),
            "",
            f"Run commit: {latest_payload.get('git_commit_short', 'unknown')}",
        ]
        with open(summary_path, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")

    return 1 if p95_fail else 0


if __name__ == "__main__":
    sys.exit(main())
