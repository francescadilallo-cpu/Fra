---
name: context-map-navigator
description: Use this skill when navigating the Fra/DataIntelligence repository, locating relevant files, deciding what to inspect next, or avoiding unnecessary source-code reading.
---

# Context Map Navigator

Use project documentation as a routing index.

## Navigation sequence

1. Read CLAUDE.md for:
   - commands
   - architecture
   - demo/live rules
   - mandatory documentation updates

2. Read PROJECT_KNOWLEDGE_MAP.md only for the relevant area:
   - backend endpoints
   - semantic layer
   - connectors
   - knowledge graph
   - metadata catalog
   - frontend components
   - tests

3. Convert the task into a small target:
   - endpoint name
   - component name
   - function/class name
   - test file
   - config file

4. Search for the target before opening files.

5. Open source files only after identifying a likely target.

## Avoid

- Reading backend/app/main.py from top to bottom.
- Opening every frontend component.
- Reconstructing architecture from code when PROJECT_KNOWLEDGE_MAP.md already maps it.
- Re-reading files already summarized in the current session.
