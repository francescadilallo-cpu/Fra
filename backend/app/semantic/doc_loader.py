from __future__ import annotations

import logging
from pathlib import Path

import yaml

from .doc_schema import (
    DisambiguationRule,
    EntityDoc,
    GlossaryTerm,
    MetricDoc,
    SemanticDocs,
)

logger = logging.getLogger(__name__)


class DocLoader:
    def __init__(self, docs_path: Path) -> None:
        self._path = docs_path

    def load(self) -> SemanticDocs:
        return SemanticDocs(
            entities=self.load_entities(),
            metrics=self.load_metrics(),
            glossary=self.load_glossary(),
            disambiguation_rules=self.load_rules(),
        )

    def _read(self, filename: str) -> dict | list | None:
        p = self._path / filename
        if not p.exists():
            return None
        try:
            return yaml.safe_load(p.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("DocLoader: failed to parse %s: %s", filename, exc)
            return None

    def load_entities(self) -> list[EntityDoc]:
        data = self._read("entities.yaml")
        if not data:
            return []
        return [EntityDoc(**e) for e in data.get("entities", [])]

    def load_metrics(self) -> list[MetricDoc]:
        data = self._read("metrics.yaml")
        if not data:
            return []
        return [MetricDoc(**m) for m in data.get("metrics", [])]

    def load_glossary(self) -> list[GlossaryTerm]:
        data = self._read("glossary.yaml")
        if not data:
            return []
        return [GlossaryTerm(**t) for t in data.get("terms", [])]

    def load_rules(self) -> list[DisambiguationRule]:
        data = self._read("rules.yaml")
        if not data:
            return []
        return [DisambiguationRule(**r) for r in data.get("disambiguation_rules", [])]
