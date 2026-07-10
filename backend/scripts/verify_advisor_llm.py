"""One-command E2E check of the curation advisor's LLM path.

Run it on a machine where a provider key is configured (localhost):

    cd backend && python scripts/verify_advisor_llm.py

It exercises the REAL provider call exactly the way the advisor does —
system blocks with cache_control, JSON-Schema structured outputs, the
plain-JSON fallback — against a two-table toy payload. No app state is
touched: nothing is written to the curation store or the approval queue.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

# The app reads keys from a .env via load_dotenv() in main.py — load the same
# files here so the script sees exactly what uvicorn sees.
try:
    from dotenv import load_dotenv

    _here = Path(__file__).resolve()
    for candidate in (_here.parents[1] / ".env", _here.parents[2] / ".env"):
        if candidate.exists():
            load_dotenv(candidate)
    load_dotenv()  # CWD lookup too, same as the app
except ImportError:
    pass

from app.curation.llm_advisor import (  # noqa: E402
    _RESPONSE_SCHEMA,
    _build_system_blocks,
    _complete_json,
)
from app.semantic.layer import _llm_intent_provider  # noqa: E402


def main() -> int:
    provider = _llm_intent_provider()
    if provider is None:
        print("FAIL: no provider key set (ANTHROPIC_API_KEY / GROQ_API_KEY)")
        print(
            "  Looked for a .env in backend/ and the repo root, plus the "
            "shell environment.\n"
            "  Fix: add ANTHROPIC_API_KEY=sk-ant-... to backend/.env, or "
            "export it in this shell."
        )
        return 1
    print(f"provider: {provider}")
    print(
        f"model override: ANTHROPIC_MODEL={os.getenv('ANTHROPIC_MODEL', '(default)')}"
    )

    entities = [
        {
            "name": "crm_accounts",
            "display_name": "Account",
            "canonical": "Customer",
            "columns": ["id", "name", "vat_number"],
        },
    ]
    user_payload = json.dumps(
        {
            "uncertain_tables": [
                {
                    "table": "etl_scratch_2024",
                    "columns": ["run_id", "blob"],
                    "row_count": 0,
                },
                {
                    "table": "pazienti",
                    "columns": ["id", "nome", "codice_fiscale"],
                    "row_count": 812,
                },
            ]
        }
    )

    raw = _complete_json(
        _build_system_blocks(entities, ["This workspace belongs to a clinic."]),
        user_payload,
        schema=_RESPONSE_SCHEMA,
    )
    print("raw response:")
    print(raw)

    parsed = json.loads(raw)  # raises if the contract is broken
    assert "decisions" in parsed and "merges" in parsed, "missing top-level keys"
    for d in parsed["decisions"]:
        assert d.get("decision") in ("keep", "exclude"), f"bad decision: {d}"
        assert isinstance(d.get("confidence"), (int, float)), f"no confidence: {d}"
    print(
        f"OK: {len(parsed['decisions'])} decisions, "
        f"{len(parsed['merges'])} merges — contract respected"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
