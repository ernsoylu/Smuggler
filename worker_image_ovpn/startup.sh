#!/bin/bash
# OpenVPN mule startup script — enforces VPN-first policy.
# Starts OpenVPN, waits for tun0, verifies external IP, then starts aria2.
# A kill-switch watchdog kills aria2 immediately if tun0 disappears.
set -euo pipefail

ARIA2_SECRET="${ARIA2_SECRET:-changeme}"
OVPN_CONF="/etc/openvpn/client.ovpn"
VPN_IFACE="tun0"
VPN_CHECK_TIMEOUT=30   # seconds to wait for ipinfo.io response
CONNECT_TIMEOUT=60     # seconds to wait for tun0 to appear
KILL_SWITCH_INTERVAL=5

log() { echo "[$(date -u +%T)] $*"; }

# ─── 1. Write credentials file if env vars are provided ─────────────────────
# Credentials are removed from disk as soon as the tunnel is established.
CREDS_FILE=""
if [ -n "${OVPN_USERNAME:-}" ] && [ -n "${OVPN_PASSWORD:-}" ]; then
    CREDS_FILE=$(mktemp /tmp/ovpn-creds-XXXXXX)
    chmod 600 "${CREDS_FILE}"
    printf '%s\n%s\n' "${OVPN_USERNAME}" "${OVPN_PASSWORD}" > "${CREDS_FILE}"
    log "Credentials file written (will be removed after connect)"
fi

cleanup_creds() {
    [ -n "${CREDS_FILE}" ] && rm -f "${CREDS_FILE}" 2>/dev/null || true
}
trap cleanup_creds EXIT

# ─── 2. Save the original default gateway before touching routes ─────────────
ORIG_GW=$(ip -4 route show default | awk '/default/{print $3; exit}')
ORIG_DEV=$(ip -4 route show default | awk '/default/{print $5; exit}')
log "Original gateway: ${ORIG_GW} dev ${ORIG_DEV}"

# ─── 3. Pin the VPN server endpoint to the original gateway ─────────────────
# Prevents a routing loop once OpenVPN replaces the default route with tun0.
REMOTE_HOST=$(grep -iP '^\s*remote\s+\S+' "${OVPN_CONF}" \
              | awk '{print $2}' | head -1 || true)

if [ -n "${REMOTE_HOST}" ] && [ -n "${ORIG_GW}" ]; then
    REMOTE_IP=$(getent ahostsv4 "${REMOTE_HOST}" 2>/dev/null \
                | awk 'NR==1{print $1}' || true)
    if [ -n "${REMOTE_IP}" ]; then
        ip -4 route add "${REMOTE_IP}/32" via "${ORIG_GW}" dev "${ORIG_DEV}" \
            2>/dev/null || true
        log "VPN endpoint ${REMOTE_IP} (${REMOTE_HOST}) pinned via ${ORIG_GW}"
    else
        log "WARNING: could not resolve VPN endpoint '${REMOTE_HOST}' — skipping pin"
    fi
else
    log "WARNING: no 'remote' directive found in config or no default gateway"
fi

# ─── 4. Build and launch the openvpn command ────────────────────────────────
OVPN_ARGS=(
    --config  "${OVPN_CONF}"
    --dev     "${VPN_IFACE}"
    --dev-type tun
    # Redirect all traffic through the tunnel
    --redirect-gateway def1
    # Allow up/down scripts (needed for some server-pushed options)
    --script-security 2
    # Write logs to stdout (visible via `docker logs`)
    --log /proc/1/fd/1
    # Suppress duplicate route warnings from server-pushed routes
    --route-noexec
)

if [ -n "${CREDS_FILE}" ]; then
    OVPN_ARGS+=(--auth-user-pass "${CREDS_FILE}")
fi

log "Starting OpenVPN..."
openvpn "${OVPN_ARGS[@]}" &
OVPN_PID=$!
log "OpenVPN started (PID=${OVPN_PID})"

# ─── 5. Wait for tun0 interface to appear ───────────────────────────────────
log "Waiting for ${VPN_IFACE} interface (up to ${CONNECT_TIMEOUT}s)..."
DEADLINE=$((SECONDS + CONNECT_TIMEOUT))
TUN_UP=0
while [ "${SECONDS}" -lt "${DEADLINE}" ]; do
    if ip link show "${VPN_IFACE}" &>/dev/null; then
        TUN_UP=1
        log "${VPN_IFACE} interface is up"
        break
    fi
    if ! kill -0 "${OVPN_PID}" 2>/dev/null; then
        log "ERROR: OpenVPN process exited before tunnel was established"
        exit 1
    fi
    sleep 2
done

if [ "${TUN_UP}" -eq 0 ]; then
    log "ERROR: ${VPN_IFACE} did not appear within ${CONNECT_TIMEOUT}s — aborting"
    kill "${OVPN_PID}" 2>/dev/null || true
    exit 1
fi

# ─── 6. Ensure ETH0 → original gateway routing policy (reply traffic) ────────
ETH0_IP=$(ip -4 addr show eth0 2>/dev/null \
          | awk '/inet /{print $2}' | cut -d/ -f1 | head -1 || true)
if [ -n "${ETH0_IP}" ] && [ -n "${ORIG_GW}" ]; then
    ip rule add from "${ETH0_IP}" table 128 2>/dev/null || true
    ip route add default via "${ORIG_GW}" dev "${ORIG_DEV}" table 128 2>/dev/null || true
fi

# ─── 7. Remove credentials from disk now that the tunnel is up ───────────────
cleanup_creds
CREDS_FILE=""

# ─── 8. Verify external connectivity through VPN ─────────────────────────────
log "Verifying VPN connectivity..."
EXT_JSON=$(curl -sf --max-time "${VPN_CHECK_TIMEOUT}" \
           --interface "${VPN_IFACE}" "https://ipinfo.io/json" || echo "")

if [ -z "${EXT_JSON}" ]; then
    log "ERROR: No external connectivity through VPN — aborting"
    kill "${OVPN_PID}" 2>/dev/null || true
    exit 1
fi

EXT_IP=$(echo "${EXT_JSON}" | grep -o '"ip"[^,]*' | grep -o '[0-9.]*' | head -1)
EXT_COUNTRY=$(echo "${EXT_JSON}" | grep -o '"country"[^,]*' \
              | sed 's/.*"\(.*\)".*/\1/')
log "VPN active — External IP: ${EXT_IP}  Country: ${EXT_COUNTRY}"

# ─── 9. Start aria2 daemon ──────────────────────────────────────────────────
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

# ─── 10. Kill-switch: kill aria2 immediately if tun0 disappears ─────────────
kill_switch() {
    while kill -0 "${ARIA2_PID}" 2>/dev/null; do
        sleep "${KILL_SWITCH_INTERVAL}"
        if ! ip link show "${VPN_IFACE}" &>/dev/null; then
            log "KILL-SWITCH TRIGGERED: ${VPN_IFACE} disappeared — killing aria2 (PID=${ARIA2_PID})"
            kill -9 "${ARIA2_PID}" 2>/dev/null || true
            exit 1
        fi
    done
}

kill_switch &
MONITOR_PID=$!

# ─── 11. Wait for aria2 to exit ─────────────────────────────────────────────
wait "${ARIA2_PID}" || true
log "aria2 exited — shutting down"
kill "${MONITOR_PID}" 2>/dev/null || true
kill "${OVPN_PID}"   2>/dev/null || true
ip link delete dev "${VPN_IFACE}" 2>/dev/null || true
