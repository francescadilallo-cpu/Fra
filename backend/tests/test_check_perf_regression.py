from __future__ import annotations

import json
from pathlib import Path

from tests import check_perf_regression


def _write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2), encoding="utf-8")


def test_gate_fails_on_p95_regression(tmp_path: Path, monkeypatch) -> None:
    metrics = tmp_path / "perf_metrics.json"
    history = tmp_path / "backend" / "tests" / "perf_history.json"

    latest = {
        "pure_deterministic_layer": {
            "average_ms": 10.0,
            "p50_ms": 10.0,
            "p95_ms": 30.0,
        },
        "git_commit_short": "abc123",
    }
    prev = {
        "pure_deterministic_layer": {"average_ms": 10.0, "p50_ms": 10.0, "p95_ms": 20.0}
    }

    _write(metrics, latest)
    _write(history, [prev, latest])

    monkeypatch.setattr(check_perf_regression, "METRICS_PATH", metrics)
    monkeypatch.setattr(check_perf_regression, "HISTORY_PATH", history)

    assert check_perf_regression.main() == 1


def test_gate_warns_without_fail(tmp_path: Path, monkeypatch) -> None:
    metrics = tmp_path / "perf_metrics.json"
    history = tmp_path / "backend" / "tests" / "perf_history.json"

    latest = {
        "pure_deterministic_layer": {
            "average_ms": 13.0,
            "p50_ms": 13.0,
            "p95_ms": 20.0,
        },
        "git_commit_short": "abc123",
    }
    prev = {
        "pure_deterministic_layer": {"average_ms": 10.0, "p50_ms": 10.0, "p95_ms": 20.0}
    }

    _write(metrics, latest)
    _write(history, [prev, latest])

    monkeypatch.setattr(check_perf_regression, "METRICS_PATH", metrics)
    monkeypatch.setattr(check_perf_regression, "HISTORY_PATH", history)

    assert check_perf_regression.main() == 0


def test_gate_passes_with_baseline(tmp_path: Path, monkeypatch) -> None:
    metrics = tmp_path / "perf_metrics.json"
    latest = {
        "pure_deterministic_layer": {"average_ms": 10.0, "p50_ms": 9.0, "p95_ms": 12.0},
        "git_commit_short": "abc123",
    }

    _write(metrics, latest)

    monkeypatch.setattr(check_perf_regression, "METRICS_PATH", metrics)
    monkeypatch.setattr(
        check_perf_regression, "HISTORY_PATH", tmp_path / "missing.json"
    )

    assert check_perf_regression.main() == 0
