---
name: demo-live-frontend-review
description: Use this skill when editing frontend React/TypeScript code, UI labels, page headers, sector behavior, demo/live branching, localStorage keys, frontend API calls, error handling, toast behavior, or any component visible to live users in the Fra/DataIntelligence project.
---

# Demo Live Frontend Review

Use this before and after frontend changes.

## Demo vs Live rules

For every changed component, decide whether it is visible in:

- Demo only
- Live only
- Both Demo and Live

For Live-visible UI:

- Do not show AdventureWorks language.
- Do not show demo sector names.
- Do not show Italian strings.
- Do not expose the internal words "semantic layer" or "ontology".
- Do not show demo-only agents or demo-only query examples.

## Required frontend patterns

- Use `IS_DEMO_MODE` for mode branching.
- Use `workspaceLabel(sector.name)` for user-facing workspace headers.
- Use `modeScopedSector(sectorId)` for localStorage keys.
- Use `backendErrorMessage(err)` for Axios error extraction.
- Use `toast(msg, 'success' | 'error')` for user feedback.
- Preserve cross-component events unless intentionally refactoring them:
  - `navigate-to-tab`
  - `navigate-to-query`
  - `ontology-builder-changed`
  - `pipeline-run-updated`

## Tests/checks

After frontend changes, run:

- `cd frontend && npx tsc --noEmit`
- `cd frontend && npm run build`

If text or visibility logic changed, manually inspect demo and live paths where practical.
