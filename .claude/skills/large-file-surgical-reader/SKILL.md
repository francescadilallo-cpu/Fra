---
name: large-file-surgical-reader
description: Use this skill when working with large files such as backend/app/main.py, big React components, generated-looking data files, long test files, or any file that risks wasting context.
---

# Large File Surgical Reader

Large files must be inspected surgically.

## Method

1. Identify the symbol first:
   - endpoint path
   - function name
   - class name
   - component name
   - event name
   - constant/env var

2. Search inside the file for that symbol.

3. Read a narrow window around:
   - definition
   - imports used by that definition
   - direct callers/callees
   - adjacent tests or fixtures

4. Do not read unrelated sections.

5. When editing, preserve surrounding contracts:
   - request/response shape
   - auth dependencies
   - rate limits
   - cache invalidation
   - demo/live branching
   - event names

## Output discipline

When reporting back, include only:
- what was changed
- why
- tests/checks run
- remaining risks

Do not paste large code blocks unless explicitly requested.
