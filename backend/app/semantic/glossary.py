"""Default glossary terms — loaded from glossary.yaml.

Edit glossary.yaml to customize terminology without touching Python code.

Seeded as Context Documents on first startup so they are user-editable.
"""

from __future__ import annotations

import pathlib

import yaml

_HERE = pathlib.Path(__file__).parent
_YAML_PATH = _HERE / "glossary.yaml"


def _load() -> dict[str, str]:
    try:
        data = yaml.safe_load(_YAML_PATH.read_text(encoding="utf-8"))
        return data.get("terms", {})
    except (FileNotFoundError, KeyError, Exception):
        return {}


DEFAULT_GLOSSARY: dict[str, str] = _load()
