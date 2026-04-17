#!/usr/bin/env bash
set -e

# Change to the root directory where the script is located
cd "$(dirname "$0")"

usage() {
    cat <<EOF
Usage: ./start.sh <command> [components...]

Commands:
  build [api] [web] [desktop]   Build specified components (default: api web)
  debug [api] [web]             Run dev servers locally (default: api web)
  stop                          Stop Docker Compose stack
  prune                         Tear down stack + volumes + images + orphan mules

Shortcut forms (no leading command):
  ./start.sh api web desktop    Same as: build api web desktop
  ./start.sh desktop            Same as: build desktop

Components:
  api        Flask API (docker compose up -d --build smuggler-api)
  web        React UI (docker compose up -d --build smuggler-ui)
  desktop    JavaFX client (./desktop/gradlew shadowJar)
EOF
}

# ── Component builders ─────────────────────────────────────────────────────

build_api() {
    echo "[+] Building smuggler-api…"
    docker compose up --build -d smuggler-api
}

build_web() {
    echo "[+] Building smuggler-ui…"
    docker compose up --build -d smuggler-ui
}

build_desktop() {
    echo "[+] Building smuggler-desktop (shadowJar)…"
    (cd desktop && ./gradlew shadowJar)
    local jar
    jar=$(ls -1 desktop/build/libs/smuggler-desktop-*-all.jar 2>/dev/null | head -n1)
    if [[ -n "$jar" ]]; then
        echo "[+] Desktop jar: $jar"
    fi
}

debug_api() {
    echo "[+] Starting Python API server (127.0.0.1:55555)…"
    python3 main.py &
}

debug_web() {
    echo "[+] Starting Vite frontend dev server…"
    npm run dev --prefix web &
}

# ── Dispatcher ─────────────────────────────────────────────────────────────

# Normalise: if $1 is a known component, treat the invocation as `build <args>`.
first="$1"
case "$first" in
    api|web|desktop)
        set -- build "$@"
        ;;
esac

cmd="$1"; shift || true

if [[ -z "$cmd" ]]; then
    usage
    exit 1
fi

# Parse component list (order-preserving, dedup)
components=()
seen_api=0; seen_web=0; seen_desktop=0
for c in "$@"; do
    case "$c" in
        api)     [[ $seen_api -eq 0 ]]     && { components+=(api);     seen_api=1; } ;;
        web)     [[ $seen_web -eq 0 ]]     && { components+=(web);     seen_web=1; } ;;
        desktop) [[ $seen_desktop -eq 0 ]] && { components+=(desktop); seen_desktop=1; } ;;
        *)
            echo "Unknown component: $c"
            usage
            exit 1
            ;;
    esac
done

case "$cmd" in
    build)
        if [[ ${#components[@]} -eq 0 ]]; then
            components=(api web)
        fi
        for c in "${components[@]}"; do
            case "$c" in
                api)     build_api ;;
                web)     build_web ;;
                desktop) build_desktop ;;
            esac
        done
        if [[ " ${components[*]} " == *" web "* ]]; then
            echo "[+] Smuggler UI → http://localhost:8887"
        fi
        ;;

    debug)
        if [[ ${#components[@]} -eq 0 ]]; then
            components=(api web)
        fi
        if [[ " ${components[*]} " == *" desktop "* ]]; then
            echo "[!] 'debug desktop' not supported — run ./gradlew run from desktop/ instead."
            exit 1
        fi
        trap 'kill 0' SIGINT
        for c in "${components[@]}"; do
            case "$c" in
                api) debug_api ;;
                web) debug_web ;;
            esac
        done
        wait
        ;;

    stop)
        echo "[+] Stopping Docker Compose stack…"
        docker compose stop
        ;;

    prune)
        echo "[+] Tearing down Docker Compose stack and removing volumes…"
        docker compose down -v --rmi all

        echo "[+] Searching for lingering Smuggler mules…"
        mules=$(docker ps -a -q -f name=smuggler-mule)
        if [[ -n "$mules" ]]; then
            echo "[!] Forcibly removing active/stopped mules: $mules"
            set +e
            docker rm -f $mules
            set -e
        else
            echo "[+] No active mules found."
        fi
        echo "[+] Prune complete."
        ;;

    -h|--help|help)
        usage
        ;;

    *)
        echo "Unknown command: $cmd"
        usage
        exit 1
        ;;
esac
