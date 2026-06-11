"""Default SQL query templates — loaded from seed_templates.yaml.

Edit seed_templates.yaml to add/modify/remove default templates
without touching Python code.

Templates use two safe substitution tokens:
  {year}  — replaced with the requested 4-digit year (default 2024)
  {limit} — replaced with the requested row limit (default 10, max 100)
"""

from __future__ import annotations

import pathlib

import yaml  # PyYAML — already a project dependency

_HERE = pathlib.Path(__file__).parent
_YAML_PATH = _HERE / "seed_templates.yaml"


def _load() -> list[dict]:
    try:
        data = yaml.safe_load(_YAML_PATH.read_text(encoding="utf-8"))
        return data.get("templates", [])
    except (FileNotFoundError, KeyError, Exception):
        return []


SEED_TEMPLATES: list[dict] = _load()

# Superseded seed SQL, by template name. When a deployed DB still holds one of
# these exact queries under the same name, the seeder upgrades it in place to
# the current YAML version. Templates the user has edited (SQL matches neither
# the old nor the new seed) are never touched.
SEED_SQL_MIGRATIONS: dict[str, list[str]] = {
    "Categoria con margine più alto": [
        # Pre-fix version: summed quantity per product_ref — neither margin
        # nor category, despite the template name.
        "SELECT product_ref, SUM(qty) AS total_qty\nFROM sales_order_line\nGROUP BY product_ref",
    ],
}
