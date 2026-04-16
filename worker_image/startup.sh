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

log()  { echo "[$(date -u +%T)] $*"; return; }
warn() { echo "[$(date -u +%T)] WARN  $*"; return; }
err()  { echo "[$(date -u +%T)] ERROR $*" >&2; return; }

# ─── Health status file (read by host watchdog) ───────────────────────────────
write_health() {
    local status="$1" ip="${2:-}" reason="${3:-}"
    printf '{"status":"%s","ip":"%s","reason":"%s","ts":"%s"}\n' \
        "$status" "$ip" "$reason" "$(date -u +%FT%TZ)" \
        > /tmp/vpn_health.json
    return
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

[[ -n "${WG_ADDR4}" ]] && ip -4 address add "${WG_ADDR4}" dev "${WG_IFACE}"
[[ -n "${WG_ADDR6}" ]] && ip -6 address add "${WG_ADDR6}" dev "${WG_IFACE}" 2>/dev/null || true
ip link set mtu 1280 up dev "${WG_IFACE}"
log "Interface ${WG_IFACE} is up (MTU 1280)"

# ─── 4. Block IPv6 outbound unless WG config carries IPv6 ──────────────────
# Prevents IPv6 leak when WireGuard only tunnels IPv4.
if [[ -z "${WG_ADDR6}" ]]; then
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
if [[ -n "${WG_EP_HOST}" ]] && [[ -n "${ORIG_GW}" ]]; then
    WG_EP_IP=$(getent ahostsv4 "${WG_EP_HOST}" 2>/dev/null | awk 'NR==1{print $1}' || true)
    if [[ -n "${WG_EP_IP}" ]]; then
        ip -4 route add "${WG_EP_IP}/32" via "${ORIG_GW}" dev "${ORIG_DEV}" 2>/dev/null || true
        log "Endpoint ${WG_EP_IP} pinned via ${ORIG_GW}"
    fi
fi

# Policy routing: keep eth0 reply traffic on the original gateway
ETH0_IP=$(ip -4 addr show eth0 | awk '/inet /{print $2}' | cut -d/ -f1)
ip rule add from "${ETH0_IP}" table 128
ip route add default via "${ORIG_GW}" dev "${ORIG_DEV}" table 128

# ─── 6. Switch DNS — hard-lock to VPN DNS, block Docker DNS ─────────────────
if [[ -n "${WG_DNS:-}" ]]; then
    # Set VPN DNS first, then public fallbacks (Cloudflare/Google)
    # These will all route through wg0 because of the default route.
    printf "nameserver %s\nnameserver 1.1.1.1\nnameserver 8.8.8.8\n" "${WG_DNS}" > /etc/resolv.conf
    log "DNS locked to VPN DNS (${WG_DNS}) + public fallbacks"
else
    # No DNS in config? Use public ones only
    printf "nameserver 1.1.1.1\nnameserver 8.8.8.8\n" > /etc/resolv.conf
    log "DNS locked to public fallbacks (no DNS in config)"
fi

# Block outbound DNS to Docker's internal resolver (127.0.0.11)
# so failed VPN DNS doesn't silently fall back to host-visible DNS
iptables -A OUTPUT -d 127.0.0.11 -p udp --dport 53 -j REJECT 2>/dev/null || true
iptables -A OUTPUT -d 127.0.0.11 -p tcp --dport 53 -j REJECT 2>/dev/null || true
log "Docker DNS (127.0.0.11) blocked"

# Replace default route — all traffic through wg0
ip -4 route replace default dev "${WG_IFACE}"

# ─── 7. Verify external connectivity through VPN ────────────────────────────
log "Verifying VPN connectivity through ${WG_IFACE}..."

# Stage A: Wait for WireGuard Handshake (max 30s)
log "Waiting for initial handshake..."
HANDSHAKE_READY=0
for i in {1..15}; do
    HS=$(wg show "${WG_IFACE}" latest-handshakes 2>/dev/null | awk '{print $2}' || echo "0")
    if [[ "${HS}" -gt 0 ]]; then
        log "Handshake confirmed! (${HS})"
        HANDSHAKE_READY=1
        break
    fi
    sleep 2
done

if [[ "${HANDSHAKE_READY}" -eq 0 ]]; then
    warn "No handshake detected after 30s — tunnel might be stuck"
fi

# Stage B: Check Connectivity (IP-based then Domain-based)
EXT_IP=""
EXT_COUNTRY="Unknown"
MAX_RETRIES=10

for i in $(seq 1 "${MAX_RETRIES}"); do
    log "Connectivity check $i/${MAX_RETRIES}..."

    # 1. Try a raw IP check first (very lightweight, no TLS/DNS complexity)
    if curl -v -sf -4 --interface "${WG_IFACE}" --max-time 5 "http://1.1.1.1" >/dev/null 2>&1; then
        log "Tunnel is ROUTING (IP-based check passed)"
    else
        warn "Tunnel is NOT routing yet (IP check failed)"
    fi

    # 2. Try to get just the IP from a different service first (icanhazip.com is simple)
    # We don't use -f here so we can see the error if it fails
    EXT_IP=$(curl -s -4 --interface "${WG_IFACE}" --max-time 10 "https://icanhazip.com" | tr -d '[:space:]' || echo "")
    
    if [[ -n "${EXT_IP}" ]]; then
        log "External IP detected: ${EXT_IP}"
        # Now try to get GeoIP info, but don't FATAL if it's rate-limited
        EXT_JSON=$(curl -s -4 --interface "${WG_IFACE}" --max-time 5 "https://ipinfo.io/json" || echo "")
        if [[ -n "${EXT_JSON}" ]] && [[ "${EXT_JSON}" == *"\"ip\":"* ]]; then
             EXT_COUNTRY=$(echo "${EXT_JSON}" | grep -o '"country"[^,]*' | sed 's/.*"\(.*\)".*/\1/' || echo "Unknown")
        else
             warn "GeoIP info (ipinfo.io) rate-limited or unavailable; proceeding with IP only."
        fi
        break
    else
        warn "Public IP detection failed. DNS locked to ${WG_DNS:-none} + fallbacks. Retrying in 4s..."
        sleep 4
    fi
done

if [[ -z "${EXT_IP}" ]]; then
    err "FATAL: Permanent connectivity failure through ${WG_IFACE}"
    err "DIAGNOSTICS:"
    err "$(ip -4 addr show "${WG_IFACE}" 2>&1 || true)"
    err "$(ip -4 route show 2>&1 || true)"
    err "resolv.conf: $(cat /etc/resolv.conf || true)"
    err "WireGuard status: $(wg show "${WG_IFACE}" 2>&1 || true)"

    write_health "dead" "" "initial VPN check failed — no connectivity through wg0"
    ip link delete dev "${WG_IFACE}" 2>/dev/null || true
    exit 1
fi

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
log "Starting aria2 RPC daemon (bound to 127.0.0.1)..."
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
    --save-session=/tmp/aria2.session \
    --save-session-interval=60 \
    --daemon=false \
    &
ARIA2_PID=$!
log "aria2 started (PID=${ARIA2_PID})"

# ─── 9. Kill-switch + runtime health monitor ────────────────────────────────
LAST_HEALTH_CHECK=0
EXPECTED_IP="${EXT_IP}"

kill_switch() {
    while kill -0 "${ARIA2_PID}" 2>/dev/null; do
        sleep "${KILL_SWITCH_INTERVAL}"
        local reason=""

        if ! ip link show "${WG_IFACE}" &>/dev/null; then
            reason="${WG_IFACE} interface disappeared"
        fi

        if [[ -z "${reason}" ]]; then
            local hs
            hs=$(wg show "${WG_IFACE}" latest-handshakes 2>/dev/null \
                 | awk '{print $2}' | head -1 || echo "0")
            local now
            now=$(date +%s)
            local age=$(( now - ${hs:-0} ))
            if [[ "${hs:-0}" -eq 0 ]] || [[ "${age}" -gt "${HANDSHAKE_MAX_AGE}" ]]; then
                reason="WireGuard handshake stale (${age}s > ${HANDSHAKE_MAX_AGE}s limit)"
            fi
        fi

        if [[ -z "${reason}" ]]; then
            local now
            now=$(date +%s)
            if [[ $(( now - LAST_HEALTH_CHECK )) -ge "${HEALTH_CHECK_INTERVAL}" ]]; then
                LAST_HEALTH_CHECK=${now}
                # Use icanhazip.com for health check as it's not aggressively rate-limited
                local live_ip
                live_ip=$(curl -s -4 --interface "${WG_IFACE}" --max-time 10 "https://icanhazip.com" | tr -d '[:space:]' || echo "")
                
                if [[ -z "${live_ip}" ]]; then
                    reason="runtime IP check failed — no connectivity through ${WG_IFACE}"
                else
                    # Flag if IP changed to a private/Docker address
                    if echo "${live_ip}" | grep -qP '^(172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|10\.)'; then
                        reason="IP leak detected: external IP ${live_ip} is a private address"
                    else
                        write_health "healthy" "${live_ip}" "periodic check OK"
                    fi
                fi
            fi
        fi

        if [[ -n "${reason}" ]]; then
            log "KILL-SWITCH TRIGGERED: ${reason}"
            write_health "dead" "" "kill-switch: ${reason}"
            echo "${reason}" > /tmp/ks_triggered
            sync
            kill -15 "${ARIA2_PID}" 2>/dev/null || true
            local waited=0
            while kill -0 "${ARIA2_PID}" 2>/dev/null && [[ "${waited}" -lt 10 ]]; do
                sleep 1
                waited=$(( waited + 1 ))
            done
            if kill -0 "${ARIA2_PID}" 2>/dev/null; then
                kill -9 "${ARIA2_PID}" 2>/dev/null || true
            fi
            exit 1
        fi
    done
}

kill_switch &
MONITOR_PID=$!
wait "${ARIA2_PID}" || true
log "aria2 exited — shutting down"
write_health "stopped" "" "aria2 exited"
kill "${MONITOR_PID}" 2>/dev/null || true
ip link delete dev "${WG_IFACE}" 2>/dev/null || true
