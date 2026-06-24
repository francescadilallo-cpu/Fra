---
name: token-budget-controller
description: Use this skill at the start of any Fra/DataIntelligence task that could require reading many files, exploring the repository, debugging unclear behavior, or making code changes under a limited context budget.
---

# Token Budget Controller

Goal: solve the task with the smallest useful context.

## Operating rules

1. Start with the existing project docs before opening source files:
   - CLAUDE.md
   - PROJECT_KNOWLEDGE_MAP.md
   - CHANGELOG_LIVE.md when recent changes matter

2. Do not read whole large files by default.
   - Prefer targeted search.
   - Open only the relevant function, component, endpoint, or test.
   - Summarize what was learned before opening more files.

3. Maintain a short working context:
   - Task goal
   - Files already inspected
   - Relevant contracts/invariants
   - Current hypothesis
   - Next smallest check

4. Before reading more than 3 files, ask:
   - What exact symbol, endpoint, component, or test am I looking for?
   - Can PROJECT_KNOWLEDGE_MAP.md route me instead?
   - Is there a targeted grep/search query?

5. Prefer patching one narrow area over broad rewrites.

6. If context is getting large, produce a compact handoff:
   - Problem
   - Confirmed facts
   - Files touched
   - Remaining uncertainty
   - Next command/test
