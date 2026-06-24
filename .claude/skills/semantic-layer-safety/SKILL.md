---
name: semantic-layer-safety
description: Use this skill when editing semantic query handling, NL-to-intent mapping, ontology validation, metadata catalog checks, SQL guardrails, prompt-injection defenses, deterministic query templates, provenance, lineage, golden questions, or faithfulness evaluation in the Fra/DataIntelligence project.
---

# Semantic Layer Safety

Use this when changing semantic reasoning, query answering, intent mapping, or result grounding.

## Core safety rules

- Do not let the LLM generate arbitrary SQL.
- Keep query execution deterministic through typed templates or validated connector logic.
- Validate every intent against the ontology contract and metadata catalog.
- Reject or safely fail on ambiguous, impossible, malicious, or out-of-domain requests.
- Preserve lineage/provenance in successful answers.

## SQL and prompt guardrails

Ensure the system blocks:

- destructive SQL keywords such as `DROP`, `ALTER`, `DELETE`, `INSERT`, `UPDATE`, `TRUNCATE`
- raw SQL fragments not allowed by the query contract
- system tables such as `sqlite_master`, `information_schema`, and `pg_catalog`
- access to unmapped tables
- prompt-injection attempts that ask the model to ignore rules, reveal secrets, or bypass validation

## Change protocol

When changing semantic behavior:

1. Identify affected intent categories.
2. Add or update tests for positive and negative cases.
3. Confirm provenance remains present and accurate.
4. Confirm impossible queries fail safely instead of hallucinating.
5. Re-run relevant golden questions.

## Tests to consider

- `cd backend && pytest tests/test_neurosymbolic_pipeline.py`
- `cd backend && pytest tests/test_golden_questions.py`
- `cd backend && pytest tests/test_faithfulness_eval.py`
- `cd backend && pytest tests/test_ontology_validation_hard_fail.py`
- `cd backend && pytest tests/test_ontology_validation_endpoint.py`
