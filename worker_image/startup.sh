#!/bin/bash
# Worker startup script — enforces VPN-first policy.
# WireGuard must be up and verified before aria2 is allowed to start.
set -euo pipefail

ARIA2_SECRET="${ARIA2_SECRET:-changeme}"
WG_IFACE="wg0"
WG_TIMEOUT=30        # seconds to wait for the wg0 interface
VPN_CHECK_TIMEOUT=15 # seconds for external IP check
KILL_SWITCH_INTERVAL=5

log() { echo "[$(date -u +%T)] $*"; }

# ─── 1. Bring up WireGuard ──────────────────────────────────────────────────
log "Bringing up WireGuard interface ${WG_IFACE}..."
wg-quick up "${WG_IFACE}" || { log "ERROR: wg-quick failed"; exit 1; }

# ─── 2. Wait for the interface to appear ────────────────────────────────────
for i in $(seq 1 "${WG_TIMEOUT}"); do
    if ip link show "${WG_IFACE}" &>/dev/null; then
        log "Interface ${WG_IFACE} is up (${i}s)"
        break
    fi
    if [ "${i}" -eq "${WG_TIMEOUT}" ]; then
        log "ERROR: ${WG_IFACE} did not appear within ${WG_TIMEOUT}s"
        exit 1
    fi
    sleep 1
done

# ─── 3. Verify external connectivity through VPN ────────────────────────────
log "Verifying VPN connectivity..."
EXT_JSON=$(curl -sf --max-time "${VPN_CHECK_TIMEOUT}" "https://ipinfo.io/json" || echo "")
if [ -z "${EXT_JSON}" ]; then
    log "ERROR: No external connectivity through VPN — aborting"
    wg-quick down "${WG_IFACE}" || true
    exit 1
fi

EXT_IP=$(echo "${EXT_JSON}" | grep -o '"ip": *"[^"]*"' | grep -o '[0-9.]*' | head -1)
EXT_COUNTRY=$(echo "${EXT_JSON}" | grep -o '"country": *"[^"]*"' | sed 's/.*": *"\(.*\)"/\1/')
log "VPN active — External IP: ${EXT_IP}  Country: ${EXT_COUNTRY}"

# ─── 4. Start aria2 daemon ──────────────────────────────────────────────────
log "Starting aria2 RPC daemon..."
aria2c \
    --dir=/downloads \
    --enable-rpc=true \
    --rpc-listen-all=true \
    --rpc-listen-port=6800 \
    --rpc-secret="${ARIA2_SECRET}" \
    --rpc-allow-origin-all=true \
    --continue=true \
    --max-concurrent-downloads=5 \
    --file-allocation=none \
    --bt-enable-lpd=false \
    --log-level=warn \
    --daemon=false \
    &
ARIA2_PID=$!
log "aria2 started (PID=${ARIA2_PID})"

# ─── 5. Kill-switch — monitor wg0 and kill aria2 if it goes down ────────────
kill_switch() {
    while kill -0 "${ARIA2_PID}" 2>/dev/null; do
        sleep "${KILL_SWITCH_INTERVAL}"
        if ! ip link show "${WG_IFACE}" &>/dev/null; then
            log "KILL-SWITCH TRIGGERED: ${WG_IFACE} disappeared — killing aria2 (PID=${ARIA2_PID})"
            kill -9 "${ARIA2_PID}" 2>/dev/null || true
            exit 1
        fi
    done
}

kill_switch &
MONITOR_PID=$!

# ─── 6. Wait for aria2 to exit ──────────────────────────────────────────────
wait "${ARIA2_PID}" || true
log "aria2 exited — shutting down"
kill "${MONITOR_PID}" 2>/dev/null || true
wg-quick down "${WG_IFACE}" 2>/dev/null || true
