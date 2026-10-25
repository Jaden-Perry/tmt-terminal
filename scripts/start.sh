#!/usr/bin/env bash
# Start the TMT Terminal: API on :8000, web UI on :5173. Ctrl+C stops both.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$PATH"

command -v uv >/dev/null || { echo "uv not found. See README > Setup."; exit 1; }
command -v npm >/dev/null || { echo "Node/npm not found. See README > Setup."; exit 1; }
[ -f "$ROOT/.env" ] || { cp "$ROOT/.env.example" "$ROOT/.env"; echo "Created .env from .env.example. Add your SEC_USER_AGENT and keys, then rerun."; exit 1; }

(cd "$ROOT/backend" && uv sync -q)
[ -d "$ROOT/frontend/node_modules" ] || (cd "$ROOT/frontend" && npm install --silent)

(cd "$ROOT/backend" && uv run uvicorn app.main:app --port 8000 --timeout-graceful-shutdown 3) &
API=$!
(cd "$ROOT/frontend" && npm run dev -- --strictPort) &
WEB=$!
trap 'kill $API $WEB 2>/dev/null' EXIT INT TERM

for _ in $(seq 1 30); do curl -s localhost:5173 >/dev/null 2>&1 && break; sleep 1; done
echo ""
echo "  TMT Terminal running at http://localhost:5173  (Ctrl+C to stop)"
open "http://localhost:5173" 2>/dev/null || true
wait
