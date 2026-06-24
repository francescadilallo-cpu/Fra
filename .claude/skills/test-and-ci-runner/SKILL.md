---
name: test-and-ci-runner
description: Use this skill after any code change in the Fra/DataIntelligence project to choose and run the right lint, typecheck, build, pytest, semantic evaluation, cache, performance, or CI verification commands. Also use this skill when the user asks what to test before committing or deploying.
---

# Test and CI Runner

Use this to pick checks based on changed files.

## Frontend changes

Run:

```bash
cd frontend && npx tsc --noEmit
cd frontend && npm run build
```

## Backend formatting and lint

From repo root:

```bash
ruff format backend && ruff check backend --fix
```

## Backend API changes

```bash
cd backend && pytest tests/test_api_integration.py
```

## Semantic/query changes

```bash
cd backend && pytest tests/test_neurosymbolic_pipeline.py
cd backend && pytest tests/test_golden_questions.py
cd backend && pytest tests/test_faithfulness_eval.py
```

## Agentic changes

```bash
cd backend && pytest tests/test_agentic_endpoints.py
```

## Cache changes

```bash
cd backend && pytest tests/test_semantic_cache.py
```

## KG/connectors changes

```bash
cd backend && pytest tests/test_kg_graph.py -x
```

## Ontology validation changes

```bash
cd backend && pytest tests/test_ontology_validation_hard_fail.py
cd backend && pytest tests/test_ontology_validation_endpoint.py
```

## Final rule

If shared contracts, auth, semantic state, or core models changed, escalate to:

```bash
cd backend && pytest tests/
```

Always report which checks were run and which were skipped.
