#!/bin/sh
# Smuggler installer — sets up a registry-based local install, no source
# checkout and no build toolchain required.
#
#   curl -fsSL https://raw.githubusercontent.com/ernsoylu/Smuggler/main/install.sh | sh
#
# Piping a remote script into a shell means trusting whatever the server sends.
# To read it first (recommended):
#
#   curl -fsSL https://raw.githubusercontent.com/ernsoylu/Smuggler/main/install.sh -o install.sh
#   less install.sh && sh install.sh
#
# Environment overrides:
#   SMUGGLER_DIR       install directory            (default: ~/.smuggler)
#   SMG_VERSION        image tag to pin             (default: sha-<main HEAD>)
#   SMUGGLER_NO_START  set to 1 to install but not start
#   SMUGGLER_REPO      source repo for compose/.env (default: ernsoylu/Smuggler)
#   SMUGGLER_REF       git ref to fetch files from  (default: main)
#   SMUGGLER_REGISTRY  image namespace              (default: ghcr.io/ernsoylu)
set -eu

REPO="${SMUGGLER_REPO:-ernsoylu/Smuggler}"
REF="${SMUGGLER_REF:-main}"
DIR="${SMUGGLER_DIR:-$HOME/.smuggler}"
REGISTRY="${SMUGGLER_REGISTRY:-ghcr.io/ernsoylu}"
RAW="https://raw.githubusercontent.com/${REPO}/${REF}"

if [ -t 1 ]; then
    B=$(printf '\033[1m'); R=$(printf '\033[0m')
    G=$(printf '\033[32m'); Y=$(printf '\033[33m'); E=$(printf '\033[31m')
else
    B=''; R=''; G=''; Y=''; E=''
fi

say()  { printf '%s[smuggler]%s %s\n' "$B" "$R" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$R" "$*"; }
warn() { printf '  %s⚠%s %s\n' "$Y" "$R" "$*"; }
die()  { printf '%serror:%s %s\n' "$E" "$R" "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# ── Preflight ───────────────────────────────────────────────────────────────
say "Checking prerequisites"

have docker || die "docker is not installed — see https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 \
    || die "docker compose v2 is required (the 'docker compose' subcommand, not docker-compose)"
docker info >/dev/null 2>&1 \
    || die "cannot talk to the Docker daemon — is it running, and is your user in the docker group?"
ok "docker and docker compose available"

case "$(uname -s)" in
    Linux) ;;
    *) warn "Smuggler's mules need Linux networking (WireGuard, iptables, tun) — $(uname -s) is untested" ;;
esac

case "$(uname -m)" in
    x86_64|amd64|aarch64|arm64) ok "architecture $(uname -m) is supported" ;;
    *) die "unsupported architecture $(uname -m) — images are published for amd64 and arm64 only" ;;
esac

GH_SHA_ACCEPT="Accept: application/vnd.github.sha"
if have curl; then
    fetch()    { curl -fsSL "$1" -o "$2"; }
    fetchsha() { curl -fsSL -H "$GH_SHA_ACCEPT" "$1"; }
elif have wget; then
    fetch()    { wget -qO "$2" "$1"; }
    fetchsha() { wget -qO- --header="$GH_SHA_ACCEPT" "$1"; }
else
    die "need curl or wget to download files"
fi

# ── Resolve the version to install ──────────────────────────────────────────
# Default to the immutable sha- tag of the current main HEAD rather than
# :latest, so an install is reproducible and a later main push cannot silently
# change what this machine runs. The plain-text .sha media type avoids a JSON
# parser dependency.
if [ -n "${SMG_VERSION:-}" ]; then
    VERSION="$SMG_VERSION"
    say "Installing pinned version ${VERSION}"
else
    say "Resolving latest build of ${REF}"
    HEAD_SHA=$(fetchsha "https://api.github.com/repos/${REPO}/commits/${REF}" \
        2>/dev/null || true)
    case "$HEAD_SHA" in
        *[!0-9a-f]* | '') HEAD_SHA='' ;;
    esac
    if [ -n "$HEAD_SHA" ]; then
        VERSION="sha-$(printf '%s' "$HEAD_SHA" | cut -c1-12)"
        ok "pinned to ${VERSION}"
    else
        VERSION="latest"
        warn "could not resolve ${REF} HEAD (rate limit?) — falling back to :latest"
    fi
fi

# ── Install directory ───────────────────────────────────────────────────────
say "Preparing ${DIR}"
mkdir -p "$DIR"
cd "$DIR"
# The API bind-mounts its own working directory and stores the SQLite DB,
# downloads and VPN configs beneath it (see docker-compose.yml).
mkdir -p data downloads vpn_configs logs
ok "directories ready"

fetch "${RAW}/docker-compose.yml" docker-compose.yml
fetch "${RAW}/.env.example" .env.example
ok "docker-compose.yml and .env.example downloaded"

# ── Secrets / .env ──────────────────────────────────────────────────────────
gen_secret() {
    if have openssl; then
        openssl rand -base64 32
    elif have python3; then
        python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
    else
        head -c 32 /dev/urandom | base64
    fi
}

# Replace or append KEY=VALUE in .env, writing through the existing file so its
# 0600 mode survives.
set_env() {
    if [ -f .env ] && grep -q "^$1=" .env; then
        grep -v "^$1=" .env > .env.tmp
        printf '%s=%s\n' "$1" "$2" >> .env.tmp
        cat .env.tmp > .env
        rm -f .env.tmp
    else
        printf '%s=%s\n' "$1" "$2" >> .env
    fi
}

say "Configuring secrets"
if [ -f .env ]; then
    ok ".env already exists — secrets left untouched"
else
    cat > .env <<EOF
SMG_LOGGING=true
SMG_LOG_LEVEL=INFO
# Secret key for encrypting stored secrets at rest — OpenVPN passwords AND VPN
# config bodies (WireGuard private keys, inline OpenVPN keys). Keep this stable
# and private — changing it makes existing encrypted secrets unrecoverable.
SMG_SECRET_KEY=$(gen_secret)
# Per-deployment salt for the scrypt key derivation. Not secret, but it must
# stay stable — changing it makes existing encrypted secrets unrecoverable.
SMG_SECRET_SALT=$(gen_secret)
# API token, enabled by default. Every /api/* request must carry a matching
# X-Smuggler-Token header; the web UI injects it automatically via nginx.
SMG_API_TOKEN=$(gen_secret)
EOF
    chmod 600 .env
    ok ".env created with generated SMG_SECRET_KEY, SMG_SECRET_SALT and SMG_API_TOKEN"
fi

# Always (re)pin the image tag — this is what an upgrade re-run updates.
set_env SMG_VERSION "$VERSION"
chmod 600 .env
ok "pinned SMG_VERSION=${VERSION}"

# ── Images ──────────────────────────────────────────────────────────────────
say "Pulling images (${VERSION})"
for component in api web mule-wireguard mule-openvpn; do
    docker pull "${REGISTRY}/smuggler-${component}:${VERSION}" >/dev/null \
        || die "failed to pull ${REGISTRY}/smuggler-${component}:${VERSION}"
    ok "smuggler-${component}"
done

# The API launches mules by the unqualified local tags smuggler-mule:latest and
# smuggler-mule-ovpn:latest (cli/docker_client.py), and it reaches Docker
# through a filtered socket proxy with IMAGES=0 — so it can neither build nor
# pull them. Retagging here is what puts them where the API will look.
docker tag "${REGISTRY}/smuggler-mule-wireguard:${VERSION}" smuggler-mule:latest
docker tag "${REGISTRY}/smuggler-mule-openvpn:${VERSION}" smuggler-mule-ovpn:latest
ok "mule images tagged as smuggler-mule:latest and smuggler-mule-ovpn:latest"

# ── Start ───────────────────────────────────────────────────────────────────
API_TOKEN=$(grep '^SMG_API_TOKEN=' .env | cut -d= -f2- || true)

if [ "${SMUGGLER_NO_START:-0}" = "1" ]; then
    say "Installed. Not starting (SMUGGLER_NO_START=1)."
    printf '\n  Start it with:  cd %s && docker compose up -d\n\n' "$DIR"
    exit 0
fi

say "Starting Smuggler"
docker compose up -d

printf '\n%s  Smuggler is running.%s\n\n' "$G$B" "$R"
printf '  Web UI     %shttp://127.0.0.1:8887%s\n' "$B" "$R"
printf '  API        http://127.0.0.1:55555 (loopback only)\n'
printf '  Directory  %s\n' "$DIR"
printf '  API token  %s\n' "${API_TOKEN:-<none>}"
printf '\n  Logs   cd %s && docker compose logs -f\n' "$DIR"
printf '  Stop   cd %s && docker compose down\n\n' "$DIR"
