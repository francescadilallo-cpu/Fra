from __future__ import annotations

from pathlib import Path

import pytest

from app.ontology.ontology import Ontology, OntologyValidationError

ROOT = Path(__file__).parent.parent.parent
SCENARIO = ROOT / "test_scenario"


def test_ontology_loader_accepts_reference_file() -> None:
    path = SCENARIO / "ontology_example.yaml"
    onto = Ontology.load(path)
    assert onto.entity_names()


def test_ontology_loader_hard_fails_on_invalid_relation_target(tmp_path: Path) -> None:
    bad = tmp_path / "bad.yaml"
    bad.write_text(
        """
ontology_version: 1
entities:
  SalesOrder:
    attributes:
      bad_relation:
        relation: many_to_one
        target: GhostEntity
        via: id
    sources:
      - source: erp
        table: sales_order_header
metrics: {}
dimensions: {}
known_ambiguities: []
""".strip(),
        encoding="utf-8",
    )

    with pytest.raises(OntologyValidationError):
        Ontology.load(bad)
