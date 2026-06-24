---
name: fastapi-monolith-refactor
description: Use this skill when editing backend/app/main.py or any FastAPI endpoint, auth dependency, role requirement, rate limit, cache behavior, semantic route, agent route, response model, or backend orchestration logic in the Fra/DataIntelligence project. Trigger this skill for backend API changes even if the requested change looks small.
---

# FastAPI Monolith Refactor

Use this when touching `backend/app/main.py` or backend API behavior.

## Preserve contracts

- Keep existing route paths stable unless explicitly asked to rename/remove them.
- Preserve request/response shape unless the task requires a breaking change.
- Preserve auth requirements:
  - user/admin access where already required
  - admin-only access for privileged operations
  - explicit `Depends(get_current_user)` where used
- Preserve rate limits and HTTP status behavior.
- Keep `/api/ask` aligned with `/api/semantic/ask` if either path is touched.

## Semantic stack state

When changes involve build/rebuild/load behavior:

- Respect `_ensure_semantic_loaded()` lazy initialization.
- Keep module-level `_semantic_state` consistent.
- After `POST /api/semantic/build`, ensure the refreshed catalog and KG state are swapped without requiring restart.

## Cache and invalidation

When touching ontology mappings, KG rebuilds, or semantic answers:

- Preserve optional Redis behavior.
- Preserve deterministic cache keys where applicable.
- Preserve namespace invalidation on mapping updates and KG rebuilds.

## Tests to consider

Run targeted tests based on the modified route:

- `cd backend && pytest tests/test_api_integration.py`
- `cd backend && pytest tests/test_semantic_cache.py`
- `cd backend && pytest tests/test_agentic_endpoints.py`
- `cd backend && pytest tests/test_ontology_validation_endpoint.py`

Escalate to the full backend suite when endpoint contracts or shared dependencies changed.
