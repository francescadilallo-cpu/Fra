#!/usr/bin/env bash
# Run backend (:8000) and frontend (:5173) together. Ctrl-C stops both.
#
#   ./scripts/local-run.sh
#
# Run ./scripts/local-setup.sh once first.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[ -d .venv ] || { echo "✗ .venv missing — run ./scripts/local-setup.sh first" >&2; exit 1; }
[ -f .env ] || { echo "✗ .env missing — run ./scripts/local-setup.sh first" >&2; exit 1; }
[ -d frontend/node_modules ] || { echo "✗ frontend deps missing — run ./scripts/local-setup.sh first" >&2; exit 1; }

# macOS still ships bash 3.2 as /bin/bash: keep the pids in a plain string
# rather than an array, and avoid `wait -n`.
pids=""
cleanup() {
  trap - INT TERM EXIT
  [ -n "$pids" ] && kill $pids 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# load_dotenv() in backend/app/main.py walks up from the cwd, so running
# uvicorn from backend/ still picks up the repo-root .env.
(cd backend && exec "$ROOT/.venv/bin/uvicorn" app.main:app --reload --port 8000) &
pids="$pids $!"

(cd frontend && exec npm run dev) &
pids="$pids $!"

echo
echo "  backend  → http://localhost:8000/api/health"
echo "  frontend → http://localhost:5173   (vite proxies /api → :8000)"
echo "  login    → admin / ${FRA_LOCAL_PASSWORD:-fra-local-dev}"
echo

wait
