---
name: agentic-hitl-safety
description: Use this skill when editing agentic workflows, natural-language commands that can lead to actions, write-back execution, human-in-the-loop approval, pending queues, manager approval/rejection, audit trail, admin-only agent endpoints, or concurrency behavior in the Fra/DataIntelligence project.
---

# Agentic HITL Safety

Use this when changing the executive agentic layer.

## Non-negotiable safety rules

- Never execute write-back directly from an NL command.
- Validated actions must default to `PENDING_HUMAN_APPROVAL`.
- Keep approval/rejection as an explicit manager-controlled step.
- Preserve admin-only access for privileged agent execution paths.
- Use safe parameterized execution for write-back.
- Preserve audit trail transitions.

## Expected lifecycle

1. Parse NL command.
2. Validate against semantic/business constraints.
3. Queue as pending human approval.
4. Manager approves or rejects.
5. Execute only after approval.
6. Record audit trail for every state transition.

## Edge cases to test

- unauthorized user attempts
- invalid command
- rejected action
- approved action
- second approval of already executed action
- concurrent approval attempts on the same action
- write-back failure with controlled audit state

## Tests to consider

- `cd backend && pytest tests/test_agentic_endpoints.py`
