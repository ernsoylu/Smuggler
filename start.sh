#!/usr/bin/env bash
# start.sh — Launch Smuggler API + frontend dev server.
# Runs pre-flight checks first; prompts to run setup.sh if anything is missing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}  ✓${RESET} $*"; return; }
warn() { echo -e "${YELLOW}  ⚠${RESET} $*"; return; }
fail() { echo -e "${RED}  ✗${RESET} $*"; return; }

has() { local cmd="$1"; command -v "$cmd" &>/dev/null; return; }

SETUP_NEEDED=0
needs_setup() { local msg="$1"; fail "$msg"; SETUP_NEEDED=1; return; }

# ── Pre-flight checks ─────────────────────────────────────────────────────────
echo -e "\n${BOLD}Smuggler — pre-flight checks${RESET}"

# nvm + PATH
export NVM_DIR="$HOME/.nvm"
[[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"
nvm use 20 2>/dev/null || true
export PATH="$HOME/.local/bin:$PATH"

# 1. uv
if has uv; then
    ok "uv $(uv --version | awk '{print $2}')"
else
    needs_setup "uv not found"
fi

# 2. Python dependencies (check the venv exists)
if [[ -d "$ROOT/.venv" ]]; then
    ok "Python virtualenv ready"
else
    needs_setup "Python dependencies not installed (.venv missing)"
fi

# 3. Node.js
if has node && node -e "process.exit(parseInt(process.versions.node) >= 18 ? 0 : 1)" 2>/dev/null; then
    ok "Node.js $(node --version)"
else
    needs_setup "Node.js 18+ not found"
fi

# 4. npm dependencies
if [[ -d "$ROOT/web/node_modules" ]]; then
    ok "npm dependencies ready"
else
    needs_setup "npm dependencies not installed (web/node_modules missing)"
fi

# 5. Docker daemon
if docker info &>/dev/null 2>&1; then
    ok "Docker daemon running"
else
    needs_setup "Docker daemon is not running or not accessible"
fi

# 6. WireGuard mule image
if docker image inspect smuggler-mule:latest &>/dev/null 2>&1; then
    ok "Docker image smuggler-mule:latest"
else
    needs_setup "Docker image smuggler-mule:latest not found"
fi

# 7. OpenVPN mule image
if docker image inspect smuggler-mule-ovpn:latest &>/dev/null 2>&1; then
    ok "Docker image smuggler-mule-ovpn:latest"
else
    needs_setup "Docker image smuggler-mule-ovpn:latest not found"
fi

# ── Abort if setup is needed ──────────────────────────────────────────────────
if [[ "$SETUP_NEEDED" -eq 1 ]]; then
    echo ""
    echo -e "${RED}${BOLD}One or more requirements are missing.${RESET}"
    echo -e "Run ${BOLD}./setup.sh${RESET} to install everything automatically, then try again."
    echo ""
    exit 1
fi

echo -e "\n${GREEN}${BOLD}All checks passed — starting Smuggler...${RESET}\n"

# ── Cleanup handler ───────────────────────────────────────────────────────────
cleanup() {
    echo ""
    echo "Shutting down..."
    kill "$API_PID" "$WEB_PID" 2>/dev/null || true
    wait "$API_PID" "$WEB_PID" 2>/dev/null || true
    return
}
trap cleanup EXIT INT TERM

# ── API ───────────────────────────────────────────────────────────────────────
echo "Starting Flask API on http://localhost:5000 ..."
cd "$ROOT"
uv run python -m api.run &
API_PID=$!

# ── Frontend ──────────────────────────────────────────────────────────────────
echo "Starting Vite dev server on http://localhost:5173 ..."
cd "$ROOT/web"
npm run dev &
WEB_PID=$!

echo ""
echo -e "  ${BOLD}API${RESET}  → http://localhost:5000"
echo -e "  ${BOLD}Web${RESET}  → http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both."

wait
