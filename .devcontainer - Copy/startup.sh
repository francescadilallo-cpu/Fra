#!/bin/bash
# Avvia backend
cd /workspaces/Fra
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 &

# Avvia frontend
cd /workspaces/Fra/frontend
npm run dev -- --host 0.0.0.0 --port 5173 &

echo "✅ App avviata — apri la porta 5173"
