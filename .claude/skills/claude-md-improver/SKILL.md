---
name: claude-md-improver
description: Audit and improve CLAUDE.md files in repositories. Use when user asks to check, audit, update, improve, or fix CLAUDE.md files. Scans for all CLAUDE.md files, evaluates quality against templates, outputs quality report, then makes targeted updates. Also use when the user mentions "CLAUDE.md maintenance" or "project memory optimization".
tools: Read, Glob, Grep, Bash, Edit
---

# CLAUDE.md Improver

Audit, evaluate, and improve CLAUDE.md files across a codebase to ensure Claude Code has optimal project context.

**This skill can write to CLAUDE.md files.** After presenting a quality report and getting user approval, it updates CLAUDE.md files with targeted improvements.

## Workflow

### Phase 1: Discovery

Find all CLAUDE.md files in the repository:

```bash
find . -name "CLAUDE.md" -o -name ".claude.md" -o -name ".claude.local.md" 2>/dev/null | head -50
```

**File Types & Locations:**

| Type | Location | Purpose |
|------|----------|---------|
| Project root | `./CLAUDE.md` | Primary project context (checked into git, shared with team) |
| Local overrides | `./.claude.local.md` | Personal/local settings (gitignored, not shared) |
| Global defaults | `~/.claude/CLAUDE.md` | User-wide defaults across all projects |
| Package-specific | `./packages/*/CLAUDE.md` | Module-level context in monorepos |
| Subdirectory | Any nested location | Feature/domain-specific context |

### Phase 2: Quality Assessment

For each CLAUDE.md file, evaluate against quality criteria with scores for:
- Commands/workflows documented (High weight)
- Architecture clarity (High weight)
- Non-obvious patterns (Medium weight)
- Conciseness (Medium weight)
- Currency (High weight)
- Actionability (High weight)

**Quality Scores:**
- A (90-100): Comprehensive, current, actionable
- B (70-89): Good coverage, minor gaps
- C (50-69): Basic info, missing key sections
- D (30-49): Sparse or outdated
- F (0-29): Missing or severely outdated

### Phase 3: Quality Report Output

Output a detailed report before making updates:

```
## CLAUDE.md Quality Report

### Summary
- Files found: N
- Average score: X/100 (Grade)

### [filename]
**Score: XX/100 (Grade)**

Issues:
- [specific issue]

Recommendations:
- [specific improvement]
```

### Phase 4: Targeted Updates (with Approval)

After presenting the report, ask: *"Would you like me to apply the recommended improvements?"*

Only proceed with explicit approval. Focus on:
- Adding missing but genuinely useful information
- Updating stale commands or references
- Adding non-obvious patterns discovered in the codebase

**Do NOT:**
- Restate obvious information
- Add generic advice not specific to this project
- Remove existing content without reason

### Phase 5: Apply Changes

Use the Edit tool to make targeted additions while preserving existing structure.

## Key Principles

- **Concise over comprehensive**: CLAUDE.md is part of the prompt — every line has a cost
- **Actionable commands**: Prefer copy-pasteable commands over prose descriptions
- **Non-obvious patterns**: Document gotchas and quirks, not standard practices
- **Current state**: Remove or update stale information
- **`.claude.local.md`**: Personal preferences and local setup belong here, not in shared CLAUDE.md
