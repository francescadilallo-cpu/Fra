#!/usr/bin/env bash
# One-time local bootstrap (macOS / Linux).
#
#   ./scripts/local-setup.sh
#
# Creates .venv, installs backend + frontend dependencies and writes a .env
# with a working local admin account. Safe to re-run: an existing .env is
# never overwritten.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PY_BIN="${PYTHON:-}"
LOCAL_PASSWORD="${FRA_LOCAL_PASSWORD:-fra-local-dev}"

say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 1. Interpreters ───────────────────────────────────────────────────────────
# backend/.python-version pins 3.11: duckdb 1.5.3 and pandas ship wheels for it
# on both Apple Silicon and Intel, so no source builds are needed.
if [ -z "$PY_BIN" ]; then
  for c in python3.11 python3; do
    command -v "$c" >/dev/null 2>&1 || continue
    if "$c" -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 11) else 1)'; then
      PY_BIN="$c"
      break
    fi
  done
fi
[ -n "$PY_BIN" ] || die "Python 3.11 not found. On macOS: brew install python@3.11 (or set PYTHON=/path/to/python3.11)"
say "Python: $("$PY_BIN" --version) ($PY_BIN)"

command -v node >/dev/null 2>&1 || die "Node not found. On macOS: brew install node"
say "Node: $(node --version)"

# ── 2. Backend virtualenv ─────────────────────────────────────────────────────
if [ ! -d .venv ]; then
  say "Creating .venv"
  "$PY_BIN" -m venv .venv
fi
say "Installing backend dependencies"
./.venv/bin/python -m pip install --quiet --upgrade pip
./.venv/bin/python -m pip install --quiet -r backend/requirements.txt
./.venv/bin/python -m pip install --quiet ruff  # CI lint gate, run before backend commits

# ── 3. Frontend dependencies ──────────────────────────────────────────────────
say "Installing frontend dependencies"
(cd frontend && npm ci --silent)

# ── 4. .env ───────────────────────────────────────────────────────────────────
if [ -f .env ]; then
  say ".env already exists — left untouched"
else
  say "Writing .env (admin / $LOCAL_PASSWORD)"
  secret="$(./.venv/bin/python -c 'import secrets; print(secrets.token_hex(32))')"
  hash="$(./.venv/bin/python backend/scripts/generate_password_hash.py --password "$LOCAL_PASSWORD")"
  cat > .env <<EOF
# Local development only — never commit this file (it is gitignored).
# Regenerate from scratch by deleting it and re-running ./scripts/local-setup.sh

JWT_SECRET_KEY=$secret
AUTH_USERS_JSON=[{"username":"admin","password_hash":"$hash","role":"admin"}]
ALLOWED_ORIGINS=http://localhost:5173
# Long expiry so a local session does not log you out mid-test.
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=480

# Persist the DuckDB snapshot in backend/data so restarts do not re-ingest.
FRA_STORAGE_MODE=snapshot
# Seed the four AdventureWorks demo sources (ERP/CRM/HR/PIM) from test_scenario/.
FRA_SEED_DEMO_SOURCES=true
# Build the Knowledge Graph on first query instead of at boot.
FRA_SKIP_WARMUP=true

# Optional: required for live-mode NL→SQL. Without it the LLM query path is
# disabled and /api/semantic/ask only answers deterministic templates.
# ANTHROPIC_API_KEY=sk-ant-api03-...
EOF
fi

say "Done. Start the stack with: ./scripts/local-run.sh"
