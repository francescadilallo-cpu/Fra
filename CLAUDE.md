# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Backend
cd backend && uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && npm run dev        # dev server on :5173
cd frontend && npm run build      # production build

# TypeScript check (run before committing frontend)
cd frontend && npx tsc --noEmit

# Backend lint/format — CI gate, run from repo root before every backend commit
ruff format backend && ruff check backend --fix

# Backend tests
cd backend && pytest tests/                         # full suite
cd backend && pytest tests/test_api_integration.py  # integration only
cd backend && pytest tests/test_kg_graph.py -x      # single file, stop on first failure
```

## Push convention (active branch)

```bash
git push -u origin main:claude/semantic-data-layer-yz7Ac && git push origin main
```

## Architecture

**Fra** (DataIntelligence) is a SaaS data intelligence platform: connect sources → build a unified data model → query in natural language → run AI agents.

```
Fra/
├── frontend/src/
│   ├── components/      # All views (one file per page/feature)
│   ├── api/semantic.ts  # All /api/semantic/* calls, typed against the backend
│   ├── api/client.ts    # Axios instance + JWT auth helpers
│   ├── data/            # Demo data (AW), query engine, localStorage stores
│   ├── lib/demoMode.ts  # IS_DEMO_MODE, workspaceLabel(), modeScopedSector()
│   └── contexts/        # SectorContext (active sector)
└── backend/app/
    ├── main.py          # FastAPI monolith (~5000 lines), all endpoints
    ├── kg/graph.py      # networkx Knowledge Graph
    ├── semantic/        # Semantic layer logic (metrics, hierarchies, glossary)
    ├── connectors/      # DuckDB, Postgres, SQLite, file adapters
    ├── query/           # NL→SQL engine
    └── agentic/         # AI agent workflows
```

## The most important concept: Demo vs Live

Everything branches on one boolean, decoded from the JWT at startup:

```typescript
// frontend/src/lib/demoMode.ts
export const IS_DEMO_MODE = getModeFromToken() !== 'live'
```

| | Demo | Live |
|---|---|---|
| Data | AdventureWorks (ERP manufacturing fixtures) | Real customer data via connectors |
| Sectors | 4 switchable (manufacturing/retail/healthcare/finance) | Always "manufacturing" default, switcher hidden |
| Agents | Pre-built (Sales Performance, CRM Dedup, …) | Customer-defined only |
| Query engine | Pre-computed answers (AdventureWorks) | Calls `/api/ask` or `/api/semantic/ask` |

**Rule:** live users must never see AdventureWorks terms, sector names, Italian strings, or the words "semantic layer" / "ontology". Use `workspaceLabel(sector.name)` for page headers; `modeScopedSector(sectorId)` for localStorage keys.

## Backend state machine

`_ensure_semantic_loaded()` is the lazy initialiser called by most endpoints. It builds:
1. DuckDB adapters (ERP / CRM / HR-PIM) from the snapshot file (`FRA_STORAGE_MODE=snapshot`)
2. networkx KG (memory-bounded by `FRA_KG_NODE_LIMIT` / `FRA_KG_EDGE_LIMIT`)
3. `MetadataCatalog` — durable SQLite store for user-edited templates, entity notes, relations
4. `SemanticLayer` — wraps all of the above, answers NL queries

All state lives in the module-level `_semantic_state` dict. After a `POST /api/semantic/build`, call `_refresh_catalog_and_kg_after_rebuild()` to swap in the new state without restarting.

## Render free-tier memory limits (512 MB)

These ENV vars are already set in `backend/Dockerfile`:

| Var | Value | Effect |
|---|---|---|
| `FRA_KG_NODE_LIMIT` | `5000` | KG capped at ~15 MB (default 200k = ~400 MB) |
| `FRA_KG_EDGE_LIMIT` | `5000` | Edge store capped |
| `FRA_SKIP_WARMUP` | `true` | KG built on first query, not at boot |

Raise to `0` (unlimited) on plans with ≥ 2 GB RAM.

## LLM SQL prompt size (env-tunable)

`MetadataCatalog.get_schema_context()` builds the schema block for LLM SQL generation. Bounded so a large CRM/ERP schema can't blow up the prompt:

| Var | Default | Effect |
|---|---|---|
| `FRA_SCHEMA_MAX_TABLES` | `100` | Max tables described in the prompt |
| `FRA_SCHEMA_MAX_COLS` | `40` | Max columns per table (then `… (+N more)`) |

## Key frontend patterns

**Storage split**: Bridges (cross-source entity connections) use localStorage via `ontologyExtensions.ts`; Relations (intra-source FK joins) and Metrics/Hierarchies/Segments use backend API calls.

**Cross-component navigation** uses `window.dispatchEvent(new CustomEvent(...))`:
- `navigate-to-tab` — jump to a sidebar tab
- `navigate-to-query` — open Query tab with a prefilled question
- `ontology-builder-changed` — broadcast ontology edits to subscribers
- `pipeline-run-updated` — refresh after a setup run

**Error handling**: `backendErrorMessage(err)` extracts `err.response.data.detail` from Axios errors. `toast(msg, 'success'|'error')` shows ephemeral feedback.

**SemanticLayerView section navigation**: `setSection(s: SLSection)` switches between `'overview' | 'sources' | 'entities' | 'bridges' | 'relations' | 'rules' | 'metrics' | 'hierarchies' | 'segments' | 'definitions' | 'playground'`.

**`entityTables` in RelationsSection**: merged from `draft?.entities.map(e => e.table)` + `backendSources.flatMap(s => s.tables)`. Falls back to free-text inputs when empty.

## AGENTS.md obligation

After any code change, update `PROJECT_KNOWLEDGE_MAP.md` and `CODE_AUDIT_AND_IMPROVEMENTS.md` (see `AGENTS.md`). Also append to `CHANGELOG_LIVE.md`.
