#!/usr/bin/env bash
# setup.sh — Smuggler first-time setup
# Installs all required software and builds both mule Docker images.
# Safe to re-run: every step is idempotent.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

log()     { echo -e "${BOLD}[setup]${RESET} $*"; return; }
ok()      { echo -e "${GREEN}  ✓${RESET} $*"; return; }
warn()    { echo -e "${YELLOW}  ⚠${RESET} $*"; return; }
fail()    { echo -e "${RED}  ✗${RESET} $*"; return; }
section() { echo -e "\n${CYAN}${BOLD}▶ $*${RESET}"; return; }

ERRORS=0
error() { fail "$*"; ERRORS=$((ERRORS + 1)); return; }

# ── Helper: command exists ────────────────────────────────────────────────────
has() { local cmd="$1"; command -v "$cmd" &>/dev/null; return; }

# ── 1. OS check ───────────────────────────────────────────────────────────────
section "System check"
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
    if has apt-get; then PKG="apt"; elif has dnf; then PKG="dnf"; elif has pacman; then PKG="pacman"; else PKG="unknown"; fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="mac"
    PKG="brew"
else
    error "Unsupported OS: $OSTYPE"
    exit 1
fi
ok "OS: $OS  package manager: $PKG"

# ── 2. Docker ─────────────────────────────────────────────────────────────────
section "Docker"
if ! has docker; then
    warn "Docker not found — installing..."
    if [[ "$OS" == "linux" && "$PKG" == "apt" ]]; then
        sudo apt-get update -qq
        sudo apt-get install -y --no-install-recommends \
            ca-certificates curl gnupg lsb-release
        sudo install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
            | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        sudo chmod a+r /etc/apt/keyrings/docker.gpg
        echo "deb [arch=$(dpkg --print-architecture) \
signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu \
$(lsb_release -cs) stable" \
            | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
        sudo apt-get update -qq
        sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
        sudo usermod -aG docker "$USER"
        warn "Docker installed. You may need to log out and back in for group membership to take effect."
        warn "For this session, commands will run with 'sudo docker'."
        DOCKER_CMD="sudo docker"
    elif [[ "$OS" == "mac" ]]; then
        if ! has brew; then
            error "Homebrew not found. Install it from https://brew.sh then re-run setup.sh"
            exit 1
        fi
        brew install --cask docker
        warn "Docker Desktop installed. Open it once to complete setup, then re-run setup.sh."
        exit 0
    else
        error "Cannot auto-install Docker on $OS/$PKG."
        error "Please install Docker manually: https://docs.docker.com/engine/install/"
        exit 1
    fi
else
    DOCKER_CMD="docker"
    ok "Docker found: $(docker --version)"
fi

# Verify daemon is reachable
if ! ${DOCKER_CMD} info &>/dev/null 2>&1; then
    if [[ "$DOCKER_CMD" == "docker" ]] && sudo docker info &>/dev/null 2>&1; then
        DOCKER_CMD="sudo docker"
        warn "Docker daemon requires sudo for this user. Run: sudo usermod -aG docker \$USER"
    else
        error "Docker daemon is not running. Start it and re-run setup.sh."
        exit 1
    fi
fi
ok "Docker daemon is reachable"

# ── 3. Java 21+ ───────────────────────────────────────────────────────────────
section "Java 21+ (for desktop app)"
JAVA_OK=0
if has java; then
    JAVA_VER=$("java" -version 2>&1 | grep -oP '(?<=")\d+' | head -1)
    if [[ "$JAVA_VER" -ge 21 ]]; then
        JAVA_OK=1
        ok "Java found: $(java -version 2>&1 | head -1)"
    else
        warn "Java found but version is too old (need 21+): $(java -version 2>&1 | head -1)"
    fi
fi

if [[ "$JAVA_OK" -eq 0 ]]; then
    warn "Java 21+ not found — installing..."
    if [[ "$OS" == "linux" && "$PKG" == "apt" ]]; then
        sudo apt-get update -qq
        sudo apt-get install -y temurin-21-jdk
        ok "Java 21 installed"
    elif [[ "$OS" == "mac" ]]; then
        brew tap homebrew/cask-versions
        brew install --cask temurin21
        ok "Java 21 installed via Homebrew"
    else
        error "Please install Java 21+ manually: https://adoptium.net/"
    fi
fi

# ── 4. JavaFX Runtime ──────────────────────────────────────────────────────────
section "JavaFX 21 Runtime (for desktop app)"
if [[ "$OS" == "linux" ]]; then
    # Check if javafx.controls module exists
    if ! java --list-modules 2>&1 | grep -q "javafx.controls"; then
        warn "JavaFX runtime components not found — installing..."
        if [[ "$PKG" == "apt" ]]; then
            sudo apt-get update -qq
            sudo apt-get install -y openjfx libgtk-3-0 libxxf86vm1 libgl1 || sudo apt-get install -y openjfx libgtk-3-0
            ok "JavaFX runtime and dependencies installed"
        elif [[ "$PKG" == "dnf" ]]; then
            sudo dnf install -y java-21-openjfx
            ok "JavaFX runtime installed"
        elif [[ "$PKG" == "pacman" ]]; then
            sudo pacman -S --noconfirm openjfx
            ok "JavaFX runtime installed"
        else
            error "Cannot auto-install JavaFX on $OS/$PKG. Install openjfx manually."
        fi
    else
        ok "JavaFX runtime found"
    fi
elif [[ "$OS" == "mac" ]]; then
    # On macOS, JavaFX comes bundled with most JDK distributions
    ok "JavaFX runtime included with JDK"
fi

# ── 5. Python 3.12+ ───────────────────────────────────────────────────────────
section "Python"
PYTHON_OK=0
for py in python3 python3.13 python3.12; do
    if has "$py"; then
        PY_VER=$("$py" -c "import sys; print(sys.version_info[:2])" 2>/dev/null || true)
        if "$py" -c "import sys; assert sys.version_info >= (3,12)" 2>/dev/null; then
            PYTHON_BIN="$py"
            PYTHON_OK=1
            ok "Python found: $("$py" --version)"
            break
        fi
    fi
done

if [[ "$PYTHON_OK" -eq 0 ]]; then
    warn "Python 3.12+ not found — installing..."
    if [[ "$OS" == "linux" && "$PKG" == "apt" ]]; then
        sudo apt-get update -qq
        sudo apt-get install -y python3.12 python3.12-venv python3.12-dev
        ok "Python 3.12 installed"
    elif [[ "$OS" == "mac" ]]; then
        brew install python@3.12
        ok "Python 3.12 installed via Homebrew"
    else
        error "Please install Python 3.12+ manually: https://www.python.org/downloads/"
    fi
fi

# ── 6. uv ─────────────────────────────────────────────────────────────────────
section "uv (Python package manager)"
export PATH="$HOME/.local/bin:$PATH"
if ! has uv; then
    warn "uv not found — installing..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
    ok "uv installed: $(uv --version)"
else
    ok "uv found: $(uv --version)"
fi

# ── 7. Python dependencies ────────────────────────────────────────────────────
section "Python dependencies"
cd "$ROOT"
uv sync --all-extras
ok "Python dependencies installed"

# ── 8. Node.js ────────────────────────────────────────────────────────────────
section "Node.js"
export NVM_DIR="$HOME/.nvm"
[[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"

NODE_OK=0
if has node; then
    NODE_VER=$(node -e "process.exit(parseInt(process.versions.node) >= 18 ? 0 : 1)" 2>/dev/null && echo "ok" || echo "old")
    if [[ "$NODE_VER" == "ok" ]]; then
        NODE_OK=1
        ok "Node.js found: $(node --version)"
    else
        warn "Node.js found but version is too old (need 18+): $(node --version)"
    fi
fi

if [[ "$NODE_OK" -eq 0 ]]; then
    if has nvm 2>/dev/null || [[ -s "$NVM_DIR/nvm.sh" ]]; then
        warn "Installing Node.js 20 via nvm..."
        nvm install 20
        nvm use 20
        ok "Node.js 20 installed via nvm: $(node --version)"
    elif [[ "$OS" == "linux" && "$PKG" == "apt" ]]; then
        warn "Installing Node.js 20 via NodeSource..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
        ok "Node.js installed: $(node --version)"
    elif [[ "$OS" == "mac" ]]; then
        brew install node@20
        ok "Node.js 20 installed via Homebrew"
    else
        error "Please install Node.js 18+: https://nodejs.org"
    fi
fi

# ── 9. npm dependencies ───────────────────────────────────────────────────────
section "Frontend dependencies (npm)"
cd "$ROOT/web"
npm ci --prefer-offline 2>/dev/null || npm install
ok "npm dependencies installed"

# ── 10. Create required directories ─────────────────────────────────────────
section "Directories"
cd "$ROOT"
mkdir -p downloads vpn_configs logs
ok "downloads/, vpn_configs/, logs/ ready"

# ── 11. .env file ───────────────────────────────────────────────────────────
section "Environment config"
cd "$ROOT"
if [[ ! -f .env ]]; then
    cat > .env <<'EOF'
DVD_LOGGING=true
DVD_LOG_LEVEL=INFO
EOF
    ok ".env created with defaults"
else
    ok ".env already exists — skipping"
fi

# ── 12. Build WireGuard mule image ──────────────────────────────────────────
section "Docker image: smuggler-mule (WireGuard)"
cd "$ROOT"
if ${DOCKER_CMD} image inspect smuggler-mule:latest &>/dev/null; then
    ok "smuggler-mule:latest already exists — skipping build"
    warn "Run '${DOCKER_CMD} rmi smuggler-mule:latest' first to force a rebuild."
else
    log "Building smuggler-mule:latest from worker_image/..."
    ${DOCKER_CMD} build -t smuggler-mule:latest worker_image/
    ok "smuggler-mule:latest built successfully"
fi

# ── 13. Build OpenVPN mule image ────────────────────────────────────────────
section "Docker image: smuggler-mule-ovpn (OpenVPN)"
cd "$ROOT"
if ${DOCKER_CMD} image inspect smuggler-mule-ovpn:latest &>/dev/null; then
    ok "smuggler-mule-ovpn:latest already exists — skipping build"
    warn "Run '${DOCKER_CMD} rmi smuggler-mule-ovpn:latest' first to force a rebuild."
else
    log "Building smuggler-mule-ovpn:latest from worker_image_ovpn/..."
    ${DOCKER_CMD} build -t smuggler-mule-ovpn:latest worker_image_ovpn/
    ok "smuggler-mule-ovpn:latest built successfully"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
if [[ "$ERRORS" -gt 0 ]]; then
    echo -e "${RED}${BOLD}Setup completed with ${ERRORS} error(s). Fix the errors above and re-run setup.sh.${RESET}" >&2
    exit 1
else
    echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════╗${RESET}"
    echo -e "${GREEN}${BOLD}║   Smuggler setup complete — ready to go  ║${RESET}"
    echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════╝${RESET}"
    echo ""
    echo -e "  Start the app :  ${BOLD}./start.sh${RESET}"
    echo -e "  CLI help      :  ${BOLD}uv run smg --help${RESET}"
    echo -e "  Desktop app   :  ${BOLD}desktop/gradlew -p desktop installDist && desktop/build/install/smuggler-desktop/bin/smuggler-desktop${RESET}"
    echo -e "  Add a VPN     :  drop a .conf or .ovpn file into ${BOLD}vpn_configs/${RESET}"
    echo ""
fi
