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

# ── 4. Resource profile ───────────────────────────────────────────────────────
# Measured on the AdventureWorks demo set: an unbounded Knowledge Graph peaks at
# ~593 MB RSS (173,786 nodes / 131,472 edges), and snapshot mode writes a DuckDB
# file plus temporaries. Both are fine on a roomy machine and both hurt on a
# small one — a nearly full APFS volume turns the snapshot write into a stall
# that looks exactly like a hung backend. Pick the profile from the hardware.
ram_gb=0
if [ "$(uname -s)" = "Darwin" ]; then
  ram_gb=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824 ))
elif [ -r /proc/meminfo ]; then
  ram_gb=$(awk '/^MemTotal:/ {printf "%d", $2/1048576}' /proc/meminfo)
fi
# Free space on the volume holding the repo, not on "/": on macOS those differ.
disk_gb=$(df -k "$ROOT" 2>/dev/null | awk 'NR==2 {printf "%d", $4/1048576}')
: "${disk_gb:=0}"

if [ -n "${FRA_LOCAL_PROFILE:-}" ]; then
  PROFILE="$FRA_LOCAL_PROFILE"
  say "Profile: $PROFILE (forced via FRA_LOCAL_PROFILE)"
elif [ "$ram_gb" -le 8 ] || [ "$disk_gb" -le 15 ]; then
  PROFILE=constrained
  say "Profile: constrained (${ram_gb}GB RAM, ${disk_gb}GB free) — in-memory store, capped graph"
else
  PROFILE=full
  say "Profile: full (${ram_gb}GB RAM, ${disk_gb}GB free) — disk snapshot, uncapped graph"
fi

if [ "$PROFILE" = constrained ]; then
  STORAGE_BLOCK="# Constrained profile: keep DuckDB in memory. Nothing is written to
# backend/data, which is what matters on a nearly full disk — snapshot mode
# stalls there. Cost: the store is rebuilt at each restart (~5-10s).
FRA_STORAGE_MODE=nostore

# Cap the Knowledge Graph: ~375 MB instead of ~593 MB, and still 60,803 nodes /
# 39,040 edges — plenty to work with. Raise or remove once the machine has room.
FRA_KG_NODE_LIMIT=20000
FRA_KG_EDGE_LIMIT=20000"
else
  STORAGE_BLOCK="# Persist the DuckDB snapshot in backend/data so restarts do not re-ingest.
FRA_STORAGE_MODE=snapshot
# Knowledge Graph left uncapped: the full demo graph is 173,786 nodes /
# 131,472 edges and peaks at ~593 MB."
fi

# ── 5. .env ───────────────────────────────────────────────────────────────────
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

$STORAGE_BLOCK

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
