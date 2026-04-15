#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ensure nvm + uv are available
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 20 2>/dev/null || true
export PATH="$HOME/.local/bin:$PATH"

cleanup() {
  echo ""
  echo "Shutting down…"
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
  wait "$API_PID" "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── API ───────────────────────────────────────────────────────────────────────
echo "Starting Flask API on http://localhost:5000 …"
cd "$ROOT"
uv run python -m api.run &
API_PID=$!

# ── Frontend ──────────────────────────────────────────────────────────────────
echo "Starting Vite dev server on http://localhost:5173 …"
cd "$ROOT/web"
npm run dev &
WEB_PID=$!

echo ""
echo "  API  → http://localhost:5000"
echo "  Web  → http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both."

wait
