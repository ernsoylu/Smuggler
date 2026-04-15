#!/bin/bash
# Worker startup script — enforces VPN-first policy.
# Uses raw `wg` + `ip` commands instead of wg-quick to avoid sysctl
# permission issues inside Docker containers.
set -euo pipefail

ARIA2_SECRET="${ARIA2_SECRET:-changeme}"
WG_CONF="/etc/wireguard/wg0.conf"
WG_IFACE="wg0"
VPN_CHECK_TIMEOUT=15 # seconds for external IP check
KILL_SWITCH_INTERVAL=5

log() { echo "[$(date -u +%T)] $*"; }

# ─── 1. Parse key fields from the WireGuard config ──────────────────────────
# Address line may contain IPv4 and/or IPv6 separated by commas
WG_ADDR4=$(grep -oP '(?i)(?<=Address\s=\s|Address=)\s*[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/[0-9]+' \
           "$WG_CONF" | tr -d ' ' | head -1 || true)

WG_ADDR6=$(awk -F'=' '/^Address/{print $2}' "$WG_CONF" \
           | tr ',' '\n' | grep ':' | tr -d ' ' | head -1 || true)

# Endpoint hostname (strip the port)
WG_EP_HOST=$(grep -oP '(?i)(?<=Endpoint\s=\s|Endpoint=)[^\s:]+' "$WG_CONF" \
             | tr -d ' ' | head -1 || true)

# DNS (first IPv4 entry only)
WG_DNS=$(grep -oP '(?i)(?<=DNS\s=\s|DNS=)[0-9.]+' "$WG_CONF" | head -1 || true)

log "Config: addr4=${WG_ADDR4} addr6=${WG_ADDR6:-none} endpoint=${WG_EP_HOST} dns=${WG_DNS:-none}"

# ─── 2. Save the original default gateway before touching routes ─────────────
ORIG_GW=$(ip -4 route show default | awk '/default/{print $3; exit}')
ORIG_DEV=$(ip -4 route show default | awk '/default/{print $5; exit}')
# Save original resolv.conf so we can use it during the VPN check
ORIG_RESOLV=$(cat /etc/resolv.conf)
log "Original gateway: ${ORIG_GW} dev ${ORIG_DEV}"

# ─── 3. Create the WireGuard interface manually ─────────────────────────────
log "Creating WireGuard interface ${WG_IFACE}..."
ip link add dev "${WG_IFACE}" type wireguard || {
    log "ERROR: Could not create WireGuard interface (missing kernel module?)"
    exit 1
}

# Strip wg-quick-only fields before passing to `wg setconf`
# (Address, DNS, MTU, Table, Pre/PostUp/Down are wg-quick extensions, not raw WG)
WG_CONF_STRIPPED=$(mktemp)
grep -vP '^\s*(Address|DNS|MTU|Table|PreUp|PostUp|PreDown|PostDown)\s*=' \
    "${WG_CONF}" > "${WG_CONF_STRIPPED}"

wg setconf "${WG_IFACE}" "${WG_CONF_STRIPPED}" || {
    rm -f "${WG_CONF_STRIPPED}"
    ip link delete dev "${WG_IFACE}" 2>/dev/null || true
    log "ERROR: wg setconf failed"
    exit 1
}
rm -f "${WG_CONF_STRIPPED}"

[ -n "${WG_ADDR4}" ] && ip -4 address add "${WG_ADDR4}" dev "${WG_IFACE}"
[ -n "${WG_ADDR6}" ] && ip -6 address add "${WG_ADDR6}" dev "${WG_IFACE}" 2>/dev/null || true

ip link set mtu 1420 up dev "${WG_IFACE}"
log "Interface ${WG_IFACE} is up"

# ─── 4. Set up routing ──────────────────────────────────────────────────────
# Pin the VPN endpoint to the original gateway so WireGuard's UDP traffic
# doesn't loop through wg0 once we change the default route.
if [ -n "${WG_EP_HOST}" ] && [ -n "${ORIG_GW}" ]; then
    # Prefer IPv4 endpoint address; getent ahostsv4 returns only A records
    WG_EP_IP=$(getent ahostsv4 "${WG_EP_HOST}" 2>/dev/null | awk 'NR==1{print $1}' || true)
    if [ -n "${WG_EP_IP}" ]; then
        ip -4 route add "${WG_EP_IP}/32" via "${ORIG_GW}" dev "${ORIG_DEV}" 2>/dev/null || true
        log "Endpoint ${WG_EP_IP} (IPv4) pinned via ${ORIG_GW}"
    else
        # IPv6 endpoint: the existing IPv6 default route on eth0 handles it
        WG_EP_IP6=$(getent ahostsv6 "${WG_EP_HOST}" 2>/dev/null | awk 'NR==1{print $1}' || true)
        log "Endpoint ${WG_EP_IP6:-unknown} (IPv6) — using existing eth0 IPv6 route"
    fi
fi

# Route all IPv4 traffic through the tunnel
ip -4 route replace default dev "${WG_IFACE}"

# ─── 5. Verify external connectivity through VPN ────────────────────────────
# Keep original resolv.conf during the check so we can resolve ipinfo.io.
# The VPN DNS (10.x.x.x) is only reachable once the tunnel is confirmed.
log "Verifying VPN connectivity (using original DNS for name resolution)..."
EXT_JSON=$(curl -sf --max-time "${VPN_CHECK_TIMEOUT}" "https://ipinfo.io/json" || echo "")
if [ -z "${EXT_JSON}" ]; then
    log "ERROR: No external connectivity through VPN — aborting"
    ip link delete dev "${WG_IFACE}" 2>/dev/null || true
    exit 1
fi

EXT_IP=$(echo "${EXT_JSON}"      | grep -o '"ip"[^,]*'      | grep -o '[0-9.]*'   | head -1)
EXT_COUNTRY=$(echo "${EXT_JSON}" | grep -o '"country"[^,]*' | sed 's/.*"\(.*\)".*/\1/')
log "VPN active — External IP: ${EXT_IP}  Country: ${EXT_COUNTRY}"

# ─── 6. Switch DNS to VPN DNS (now that the tunnel is confirmed) ─────────────
if [ -n "${WG_DNS}" ]; then
    echo "nameserver ${WG_DNS}" > /etc/resolv.conf
    log "DNS switched to VPN DNS: ${WG_DNS}"
fi

# ─── 7. Start aria2 daemon ──────────────────────────────────────────────────
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

# ─── 8. Kill-switch — monitor wg0 and kill aria2 if it goes down ────────────
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

# ─── 9. Wait for aria2 to exit ──────────────────────────────────────────────
wait "${ARIA2_PID}" || true
log "aria2 exited — shutting down"
kill "${MONITOR_PID}" 2>/dev/null || true
ip link delete dev "${WG_IFACE}" 2>/dev/null || true
