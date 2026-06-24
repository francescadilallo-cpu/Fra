---
name: fra-project-guardian
description: Use this skill whenever working in the Fra/DataIntelligence repository, especially for multi-file changes, architecture-sensitive edits, demo/live behavior, semantic data workflows, documentation updates, or pre-commit review. This skill enforces the repository's non-negotiable project rules and should trigger even when the user only asks for a seemingly small code change.
---

# Fra Project Guardian

Use this as the baseline operating checklist for the Fra/DataIntelligence repository.

## Non-negotiable rules

1. Preserve Demo vs Live separation.
   - Live users must never see AdventureWorks terms.
   - Live users must never see demo sector names.
   - Live users must never see Italian strings.
   - Live users must never see the product-internal words "semantic layer" or "ontology".
   - Use `workspaceLabel(sector.name)` for user-facing page headers.
   - Use `modeScopedSector(sectorId)` for localStorage keys.

2. Keep changes small and traceable.
   - Prefer targeted edits over broad rewrites.
   - Do not introduce new architectural patterns unless the task requires it.
   - Preserve existing endpoint contracts and UI behavior unless explicitly asked to change them.

3. After code changes, update project documentation.
   - `PROJECT_KNOWLEDGE_MAP.md`
   - `CODE_AUDIT_AND_IMPROVEMENTS.md`
   - `CHANGELOG_LIVE.md`

4. Run the relevant checks before considering the work complete.
   - Frontend: `cd frontend && npx tsc --noEmit`
   - Frontend build: `cd frontend && npm run build`
   - Backend lint/format: `ruff format backend && ruff check backend --fix`
   - Backend tests: choose targeted tests first, then broader tests when needed.

## Work protocol

Before editing, identify which area is affected:

- Frontend React/TypeScript
- FastAPI endpoints
- Semantic query flow
- Knowledge graph or connectors
- Agentic HITL workflow
- Metadata/catalog/ontology mapping
- CI/tests/docs

Then activate the more specific skill for that area if available.

## Completion checklist

Before final response:

- Summarize changed files.
- List checks run and their result.
- Mention checks not run.
- Mention documentation files updated.
- Call out any risks or follow-up work.
