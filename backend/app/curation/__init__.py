"""Curation layer — keeps the semantic surface business-relevant and light.

After the connector-level hard filters (technical objects, custom settings,
custom metadata, …) this layer performs a second, source-agnostic pruning pass
BEFORE tables become entities in the Knowledge Graph and data model:

- ``engine``  — deterministic classifier: skill-pack rules + structural
  signals decide keep / excluded / uncertain per table.
- ``skills/`` — the agent's editable knowledge: YAML packs per source type
  plus a per-workspace pack (rules and concept aliases), changeable without
  a deploy.
- ``store``   — reversible decisions (excluded tables stay in DuckDB and can
  be re-included with one call; nothing is deleted).
"""
