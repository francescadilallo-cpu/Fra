---
name: documentation-sync
description: Use this skill after code changes in the Fra/DataIntelligence project, especially when endpoints, frontend views, semantic behavior, KG/connectors, agentic workflows, tests, CI gates, or deployment behavior changed. This skill updates the required project documentation and changelog so docs stay aligned with the code.
---

# Documentation Sync

Use after every code change.

## Required files

Update all three when applicable:

1. `PROJECT_KNOWLEDGE_MAP.md`
   - Update architecture notes.
   - Update endpoint lists.
   - Update file/module references.
   - Update test coverage notes.

2. `CODE_AUDIT_AND_IMPROVEMENTS.md`
   - Record risks, technical debt, improvements, and rationale.
   - Mention known limitations honestly.

3. `CHANGELOG_LIVE.md`
   - Add concise user-facing or operational change summary.
   - Avoid overstating work.
   - Include migration or validation notes if relevant.

## Writing rules

- Be factual.
- Reflect actual code changes only.
- Do not claim tests passed unless they were run.
- Keep entries concise and useful for future maintainers.

## Final response

Mention documentation files updated and any documentation intentionally left unchanged.
