---
name: surgical-code-editor
description: Use this skill when implementing code changes in Fra/DataIntelligence while minimizing token usage, diffs, and regression risk.
---

# Surgical Code Editor

Make the smallest correct change.

## Before editing

1. State the narrow target.
2. Identify the existing pattern to follow.
3. Check whether a test already covers it.
4. Check whether demo/live behavior is affected.

## During editing

1. Prefer modifying existing functions over adding new abstractions.
2. Avoid broad formatting-only changes.
3. Avoid renaming unless required.
4. Avoid moving code unless the task is explicitly refactor-focused.
5. Preserve public contracts and API shapes.
6. Keep UI copy centralized and demo/live safe.

## After editing

1. Run the most targeted test/check first.
2. Run broader checks only when the touched area justifies it.
3. Update required docs only with delta-level changes.
4. Summarize the diff in compact bullets.
