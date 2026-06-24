---
name: delta-documentation-updater
description: Use this skill after code changes in Fra/DataIntelligence to update required documentation with concise deltas instead of rewriting large documents.
---

# Delta Documentation Updater

After code changes, update only the relevant sections of:

- PROJECT_KNOWLEDGE_MAP.md
- CODE_AUDIT_AND_IMPROVEMENTS.md
- CHANGELOG_LIVE.md

## Rules

1. Do not rewrite entire documents.
2. Find the relevant heading and append or edit a small section.
3. Keep entries factual:
   - what changed
   - affected files/modules
   - test/check status
   - known limitations

4. Do not claim tests passed unless they were run.
5. Do not duplicate existing entries.
6. Keep CHANGELOG_LIVE.md user-facing and concise.
7. Keep PROJECT_KNOWLEDGE_MAP.md architectural/operational.
8. Keep CODE_AUDIT_AND_IMPROVEMENTS.md focused on risk, rationale, and follow-up work.
