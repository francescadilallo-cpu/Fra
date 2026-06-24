---
name: knowledge-graph-connectors
description: Use this skill when editing data connectors, DuckDB source management, snapshot/nostore storage behavior, Knowledge Graph construction, networkx graph logic, identity resolution, provenance, metadata loading, memory limits, or source-table integration in the Fra/DataIntelligence project.
---

# Knowledge Graph and Connectors

Use this for connector, KG, data loading, and metadata integration changes.

## Connector contract

Preserve the common connector interface:

- `load_entity`
- `describe`
- `execute_query`

Do not make connector-specific assumptions leak into shared semantic/query logic.

## Storage behavior

Respect runtime modes:

- `FRA_STORAGE_MODE=nostore`: no persistent local datalake, runtime in memory.
- `FRA_STORAGE_MODE=snapshot`: optional persistent DuckDB snapshot.

Preserve legacy-compatible views if the rest of the app still depends on them.

## Knowledge graph rules

- Preserve node and edge provenance.
- Preserve typed nodes and semantic edges.
- Preserve identity resolution behavior.
- Preserve CRM dedup behavior.
- Respect memory limits:
  - `FRA_KG_NODE_LIMIT`
  - `FRA_KG_EDGE_LIMIT`

## Tests to consider

- `cd backend && pytest tests/test_kg_graph.py -x`
- tests covering connector row counts and source descriptions
- tests covering provenance and identity resolution
- performance profiling if graph size or loading behavior changed
