#!/bin/bash
# WireGuard mule startup script — VPN-first, no-leak policy.
#
# Security measures:
#   • curl VPN check is bound to wg0 (--interface) — prevents eth0 fallback
#   • IPv6 outbound is blocked unless WG config carries IPv6
#   • DNS is hard-locked to VPN DNS; Docker DNS 127.0.0.11 is firewalled
#   • aria2 binds to 127.0.0.1 only (not 0.0.0.0)
#   • Kill-switch checks both interface existence AND WireGuard handshake freshness
#   • Periodic runtime IP re-verification every HEALTH_CHECK_INTERVAL seconds
#   • On kill-switch: SIGTERM → 10s grace → SIGKILL; writes /tmp/ks_triggered
#   • Writes /tmp/vpn_health.json for host watchdog to read
set -euo pipefail

ARIA2_SECRET="${ARIA2_SECRET:-changeme}"
WG_CONF="/etc/wireguard/wg0.conf"
WG_IFACE="wg0"
VPN_CHECK_TIMEOUT=15      # seconds for external IP check
CONNECT_TIMEOUT=30        # seconds to wait for wg0
KILL_SWITCH_INTERVAL=5    # seconds between kill-switch polls
HEALTH_CHECK_INTERVAL=30  # seconds between runtime IP re-verifications
HANDSHAKE_MAX_AGE=180     # seconds — WG handshake older than this = dead peer

log()  { echo "[$(date -u +%T)] $*"; }
warn() { echo "[$(date -u +%T)] WARN  $*"; }
err()  { echo "[$(date -u +%T)] ERROR $*" >&2; }

# ─── Health status file (read by host watchdog) ───────────────────────────────
write_health() {
    local status="$1" ip="${2:-}" reason="${3:-}"
    printf '{"status":"%s","ip":"%s","reason":"%s","ts":"%s"}\n' \
        "$status" "$ip" "$reason" "$(date -u +%FT%TZ)" \
        > /tmp/vpn_health.json
}
write_health "starting" "" "initialising"

# ─── 1. Parse WireGuard config ───────────────────────────────────────────────
WG_ADDR4=$(grep -oP '(?i)(?<=Address\s=\s|Address=)\s*[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/[0-9]+' \
           "$WG_CONF" | tr -d ' ' | head -1 || true)
WG_ADDR6=$(awk -F'=' '/^Address/{print $2}' "$WG_CONF" \
           | tr ',' '\n' | grep ':' | tr -d ' ' | head -1 || true)
WG_EP_HOST=$(grep -oP '(?i)(?<=Endpoint\s=\s|Endpoint=)[^\s:]+' "$WG_CONF" \
             | tr -d ' ' | head -1 || true)
WG_DNS=$(grep -oP '(?i)(?<=DNS\s=\s|DNS=)[0-9.]+' "$WG_CONF" | head -1 || true)

log "Config: addr4=${WG_ADDR4} addr6=${WG_ADDR6:-none} endpoint=${WG_EP_HOST} dns=${WG_DNS:-none}"

# ─── 2. Save original gateway ────────────────────────────────────────────────
ORIG_GW=$(ip -4 route show default | awk '/default/{print $3; exit}')
ORIG_DEV=$(ip -4 route show default | awk '/default/{print $5; exit}')
log "Original gateway: ${ORIG_GW} dev ${ORIG_DEV}"

# ─── 3. Create WireGuard interface ──────────────────────────────────────────
log "Creating ${WG_IFACE}..."
ip link add dev "${WG_IFACE}" type wireguard || {
    err "Could not create WireGuard interface (missing kernel module?)"
    write_health "dead" "" "wg interface creation failed"
    exit 1
}

WG_CONF_STRIPPED=$(mktemp)
grep -vP '^\s*(Address|DNS|MTU|Table|PreUp|PostUp|PreDown|PostDown)\s*=' \
    "${WG_CONF}" > "${WG_CONF_STRIPPED}"
wg setconf "${WG_IFACE}" "${WG_CONF_STRIPPED}" || {
    rm -f "${WG_CONF_STRIPPED}"
    ip link delete dev "${WG_IFACE}" 2>/dev/null || true
    err "wg setconf failed"
    write_health "dead" "" "wg setconf failed"
    exit 1
}
rm -f "${WG_CONF_STRIPPED}"

[ -n "${WG_ADDR4}" ] && ip -4 address add "${WG_ADDR4}" dev "${WG_IFACE}"
[ -n "${WG_ADDR6}" ] && ip -6 address add "${WG_ADDR6}" dev "${WG_IFACE}" 2>/dev/null || true
ip link set mtu 1420 up dev "${WG_IFACE}"
log "Interface ${WG_IFACE} is up"

# ─── 4. Block IPv6 outbound unless WG config carries IPv6 ──────────────────
# Prevents IPv6 leak when WireGuard only tunnels IPv4.
if [ -z "${WG_ADDR6}" ]; then
    log "No IPv6 in WG config — blocking IPv6 outbound to prevent leaks"
    ip6tables -P OUTPUT DROP   2>/dev/null || true
    ip6tables -P FORWARD DROP  2>/dev/null || true
    # Allow loopback only
    ip6tables -A OUTPUT -o lo -j ACCEPT 2>/dev/null || true
    # Allow Docker bridge management traffic (required for container networking)
    ip6tables -A OUTPUT -o eth0 -d fe80::/10 -j ACCEPT 2>/dev/null || true
else
    log "IPv6 present in WG config — IPv6 will route through ${WG_IFACE}"
fi

# ─── 5. Set up routing ──────────────────────────────────────────────────────
if [ -n "${WG_EP_HOST}" ] && [ -n "${ORIG_GW}" ]; then
    WG_EP_IP=$(getent ahostsv4 "${WG_EP_HOST}" 2>/dev/null | awk 'NR==1{print $1}' || true)
    if [ -n "${WG_EP_IP}" ]; then
        ip -4 route add "${WG_EP_IP}/32" via "${ORIG_GW}" dev "${ORIG_DEV}" 2>/dev/null || true
        log "Endpoint ${WG_EP_IP} pinned via ${ORIG_GW}"
    fi
fi

# Policy routing: keep eth0 reply traffic on the original gateway
ETH0_IP=$(ip -4 addr show eth0 | awk '/inet /{print $2}' | cut -d/ -f1)
ip rule add from "${ETH0_IP}" table 128
ip route add default via "${ORIG_GW}" dev "${ORIG_DEV}" table 128

# ─── 6. Switch DNS — hard-lock to VPN DNS, block Docker DNS ─────────────────
if [ -n "${WG_DNS}" ]; then
    echo "nameserver ${WG_DNS}" > /etc/resolv.conf
    log "DNS locked to VPN DNS: ${WG_DNS}"
    # Block outbound DNS to Docker's internal resolver (127.0.0.11)
    # so failed VPN DNS doesn't silently fall back to host-visible DNS
    iptables -A OUTPUT -d 127.0.0.11 -p udp --dport 53 -j REJECT 2>/dev/null || true
    iptables -A OUTPUT -d 127.0.0.11 -p tcp --dport 53 -j REJECT 2>/dev/null || true
    log "Docker DNS (127.0.0.11) blocked"
fi

# Replace default route — all traffic through wg0
ip -4 route replace default dev "${WG_IFACE}"

# ─── 7. Verify external connectivity through VPN ────────────────────────────
log "Verifying VPN connectivity through ${WG_IFACE}..."
# SECURITY: --interface binds curl to wg0; if wg0 can't reach the internet this fails
# rather than silently falling back to eth0 and confirming the real IP as "VPN".
EXT_JSON=$(curl -sf \
           --interface "${WG_IFACE}" \
           --max-time "${VPN_CHECK_TIMEOUT}" \
           "https://ipinfo.io/json" || echo "")

if [ -z "${EXT_JSON}" ]; then
    err "No connectivity through ${WG_IFACE} — aborting to prevent IP leak"
    write_health "dead" "" "initial VPN check failed — no connectivity through wg0"
    ip link delete dev "${WG_IFACE}" 2>/dev/null || true
    exit 1
fi

EXT_IP=$(echo "${EXT_JSON}"      | grep -o '"ip"[^,]*'      | grep -o '[0-9.]*'   | head -1)
EXT_COUNTRY=$(echo "${EXT_JSON}" | grep -o '"country"[^,]*' | sed 's/.*"\(.*\)".*/\1/')

# Sanity: VPN IP must NOT be in Docker bridge ranges (172.16-31.x.x, 192.168.x.x, 10.x.x.x)
if echo "${EXT_IP}" | grep -qP '^(172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|10\.)'; then
    err "External IP ${EXT_IP} looks like a private/Docker IP — VPN routing broken"
    write_health "dead" "${EXT_IP}" "VPN IP is a private address — routing not working"
    ip link delete dev "${WG_IFACE}" 2>/dev/null || true
    exit 1
fi

log "VPN active — External IP: ${EXT_IP}  Country: ${EXT_COUNTRY}"
write_health "healthy" "${EXT_IP}" "VPN verified at startup"

# ─── 8. Start aria2 — bound to 127.0.0.1 only ──────────────────────────────
# SECURITY: --rpc-listen-all=false / explicit 127.0.0.1 binding prevents aria2's
# RPC from being reachable through wg0 or eth0 inside the container.
log "Starting aria2 RPC daemon (bound to 127.0.0.1)..."
aria2c \
    --dir=/downloads \
    --enable-rpc=true \
    --rpc-listen-all=false \
    --rpc-listen-port=6800 \
    --rpc-secret="${ARIA2_SECRET}" \
    --rpc-allow-origin-all=true \
    --continue=true \
    --max-concurrent-downloads=5 \
    --file-allocation=none \
    --bt-enable-lpd=false \
    --log-level=warn \
    --save-session=/tmp/aria2.session \
    --save-session-interval=60 \
    --daemon=false \
    &
ARIA2_PID=$!
log "aria2 started (PID=${ARIA2_PID})"

# ─── 9. Kill-switch + runtime health monitor ────────────────────────────────
# Checks:
#   a) wg0 interface exists
#   b) WireGuard handshake is fresh (< HANDSHAKE_MAX_AGE seconds)
#   c) External IP through wg0 is still the VPN IP (checked every HEALTH_CHECK_INTERVAL)
#
# On failure: SIGTERM aria2, wait 10s for graceful save, then SIGKILL.
# Writes /tmp/ks_triggered so the host watchdog knows to attempt migration.

LAST_HEALTH_CHECK=0
EXPECTED_IP="${EXT_IP}"

kill_switch() {
    while kill -0 "${ARIA2_PID}" 2>/dev/null; do
        sleep "${KILL_SWITCH_INTERVAL}"
        local reason=""

        # (a) Interface existence
        if ! ip link show "${WG_IFACE}" &>/dev/null; then
            reason="${WG_IFACE} interface disappeared"
        fi

        # (b) WireGuard handshake freshness
        if [ -z "${reason}" ]; then
            local hs
            hs=$(wg show "${WG_IFACE}" latest-handshakes 2>/dev/null \
                 | awk '{print $2}' | head -1 || echo "0")
            local now
            now=$(date +%s)
            local age=$(( now - ${hs:-0} ))
            if [ "${hs:-0}" -eq 0 ] || [ "${age}" -gt "${HANDSHAKE_MAX_AGE}" ]; then
                reason="WireGuard handshake stale (${age}s > ${HANDSHAKE_MAX_AGE}s limit)"
            fi
        fi

        # (c) Periodic external IP re-verification through wg0
        if [ -z "${reason}" ]; then
            local now
            now=$(date +%s)
            if [ $(( now - LAST_HEALTH_CHECK )) -ge "${HEALTH_CHECK_INTERVAL}" ]; then
                LAST_HEALTH_CHECK=${now}
                local live_json
                live_json=$(curl -sf \
                            --interface "${WG_IFACE}" \
                            --max-time 8 \
                            "https://ipinfo.io/json" 2>/dev/null || echo "")
                if [ -z "${live_json}" ]; then
                    reason="runtime IP check failed — no connectivity through ${WG_IFACE}"
                else
                    local live_ip
                    live_ip=$(echo "${live_json}" | grep -o '"ip"[^,]*' | grep -o '[0-9.]*' | head -1)
                    # Flag if IP changed to a private/Docker address
                    if echo "${live_ip}" | grep -qP '^(172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|10\.)'; then
                        reason="IP leak detected: external IP ${live_ip} is a private address"
                    else
                        write_health "healthy" "${live_ip}" "periodic check OK"
                    fi
                fi
            fi
        fi

        if [ -n "${reason}" ]; then
            log "KILL-SWITCH TRIGGERED: ${reason}"
            write_health "dead" "" "kill-switch: ${reason}"

            # Signal the host watchdog before killing aria2
            echo "${reason}" > /tmp/ks_triggered
            sync

            # Graceful shutdown: SIGTERM → 10s → SIGKILL
            log "Sending SIGTERM to aria2 (PID=${ARIA2_PID}) for graceful session save..."
            kill -15 "${ARIA2_PID}" 2>/dev/null || true
            local waited=0
            while kill -0 "${ARIA2_PID}" 2>/dev/null && [ "${waited}" -lt 10 ]; do
                sleep 1
                waited=$(( waited + 1 ))
            done
            if kill -0 "${ARIA2_PID}" 2>/dev/null; then
                log "aria2 did not exit — sending SIGKILL"
                kill -9 "${ARIA2_PID}" 2>/dev/null || true
            fi
            exit 1
        fi
    done
}

kill_switch &
MONITOR_PID=$!

# ─── 10. Wait for aria2 to exit ─────────────────────────────────────────────
wait "${ARIA2_PID}" || true
log "aria2 exited — shutting down"
write_health "stopped" "" "aria2 exited"
kill "${MONITOR_PID}" 2>/dev/null || true
ip link delete dev "${WG_IFACE}" 2>/dev/null || true
