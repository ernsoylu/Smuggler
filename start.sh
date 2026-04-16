#!/usr/bin/env bash
set -e

# Change to the root directory where the script is located
cd "$(dirname "$0")"

cmd="$1"

if [ -z "$cmd" ]; then
    echo "Usage: ./start.sh [debug|build|stop|prune]"
    exit 1
fi

case "$cmd" in
    debug)
        echo "[+] Starting local development environment (debug mode)..."
        # Trap to kill background processes on Ctrl+C
        trap 'kill 0' SIGINT
        
        echo "[+] Starting Vite frontend dev server..."
        npm run dev --prefix web &
        
        echo "[+] Starting Python API server..."
        python3 main.py &
        
        wait
        ;;
        
    build)
        echo "[+] Building and starting Docker Compose stack..."
        docker compose up --build -d
        echo "[+] Stack is up! Smuggler UI is running at http://localhost:8887"
        ;;
        
    stop)
        echo "[+] Stopping Docker Compose stack..."
        docker compose stop
        ;;
        
    prune)
        echo "[+] Tearing down Docker Compose stack and removing volumes..."
        docker compose down -v --rmi all
        
        echo "[+] Searching for lingering Smuggler mules..."
        mules=$(docker ps -a -q -f name=smuggler-mule)
        if [ -n "$mules" ]; then
            echo "[!] Forcibly removing active/stopped mules: $mules"
            # Disable set -e temporarily since docker rm might fail if strings are empty
            set +e
            docker rm -f $mules
            set -e
        else
            echo "[+] No active mules found."
        fi
        echo "[+] Prune complete."
        ;;
        
    *)
        echo "Unknown command: $cmd"
        echo "Usage: ./start.sh [debug|build|stop|prune]"
        exit 1
        ;;
esac
