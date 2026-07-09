"""Golden curation set — data-driven regression test for the deterministic
engine. The expectations live in ``golden_curation.yaml``; see the header
there for the contract. Add new sources/edge cases to the YAML, not here."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.curation.engine import run_curation
from app.curation.store import CurationStore
from app.semantic import canonical

_GOLDEN = yaml.safe_load(
    (Path(__file__).parent / "golden_curation.yaml").read_text(encoding="utf-8")
)


@pytest.mark.parametrize(
    "case", _GOLDEN["cases"], ids=[c["name"] for c in _GOLDEN["cases"]]
)
def test_golden_curation(case, tmp_path, monkeypatch):
    # Isolate from any real workspace pack in backend/data.
    monkeypatch.setenv("FRA_DATA_DIR", str(tmp_path))
    # The canonical dictionary is process-global and other tests teach it
    # workspace aliases (e.g. "pazienti" → Customer) via extend_aliases().
    # Reset it to the pristine shipped concepts.yaml so the golden
    # expectations don't depend on test execution order.
    monkeypatch.delenv("FRA_CONCEPTS_PATH", raising=False)
    pristine = canonical._load_concept_aliases()
    monkeypatch.setattr(canonical, "_CONCEPT_ALIASES", dict(pristine))
    monkeypatch.setattr(
        canonical,
        "_ALIAS_TO_CONCEPT",
        {alias: c for c, aliases in pristine.items() for alias in aliases},
    )

    tables = case["tables"]
    schema = {
        name: {
            "row_count": spec["rows"],
            "columns": [{"name": f"c{i}"} for i in range(spec["cols"])],
        }
        for name, spec in tables.items()
    }
    decisions = run_curation(
        schema,
        source_types=set(case.get("source_types") or []),
        relations=[
            {"from_table": r["from"], "to_table": r["to"]}
            for r in case.get("relations") or []
        ],
        labels=case.get("labels") or {},
        protected=set(case.get("protected") or []),
        store=CurationStore(tmp_path / "decisions.json"),
    )

    failures = []
    for name, spec in tables.items():
        got = decisions.get(name, {})
        if got.get("status") != spec["expect"]:
            failures.append(
                f"{name}: expected {spec['expect']}, got {got.get('status')!r} "
                f"({got.get('reason')!r})"
            )
        elif "reason" in spec and got.get("reason") != spec["reason"]:
            failures.append(
                f"{name}: expected reason {spec['reason']!r}, got {got.get('reason')!r}"
            )
    assert not failures, "golden curation drift:\n  " + "\n  ".join(failures)
