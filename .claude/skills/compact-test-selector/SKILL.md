---
name: compact-test-selector
description: Use this skill after modifying Fra/DataIntelligence code to choose the smallest meaningful test/build/lint commands before running broader checks.
---

# Compact Test Selector

Run tests proportional to the change.

## Frontend changes

For TypeScript/components/API client:
- cd frontend && npx tsc --noEmit
- cd frontend && npm run build

## Backend formatting/lint

For Python changes:
- ruff format backend && ruff check backend --fix

## Backend targeted tests

Semantic layer:
- cd backend && pytest tests/test_neurosymbolic_pipeline.py
- cd backend && pytest tests/test_golden_questions.py

Agentic layer:
- cd backend && pytest tests/test_agentic_endpoints.py

Cache:
- cd backend && pytest tests/test_semantic_cache.py

Knowledge graph:
- cd backend && pytest tests/test_kg_graph.py -x

API integration:
- cd backend && pytest tests/test_api_integration.py

## Escalation

Run the full backend suite only when:
- shared contracts changed
- fixtures changed
- auth/routing changed
- multiple modules changed
- targeted tests fail and the cause is unclear

Always report exactly which checks were run and their result.
