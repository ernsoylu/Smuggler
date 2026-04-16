#!/bin/bash
# OpenVPN mule startup script — VPN-first, no-leak policy.
#
# Security measures:
#   • curl VPN check bound to tun0 (--interface)
#   • aria2 binds to 127.0.0.1 only (not 0.0.0.0)
#   • Credentials deleted from disk immediately after tunnel established
#   • Periodic runtime IP re-verification every HEALTH_CHECK_INTERVAL seconds
#   • Kill-switch: SIGTERM → 10s grace → SIGKILL; writes /tmp/ks_triggered
#   • Writes /tmp/vpn_health.json for host watchdog
set -euo pipefail

ARIA2_SECRET="${ARIA2_SECRET:-changeme}"
OVPN_CONF="/etc/openvpn/client.ovpn"
VPN_IFACE="tun0"
VPN_CHECK_TIMEOUT=30      # seconds to wait for ipinfo.io response
CONNECT_TIMEOUT=60        # seconds to wait for tun0 to appear
KILL_SWITCH_INTERVAL=5
HEALTH_CHECK_INTERVAL=30  # seconds between runtime IP re-verifications

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

# ─── 1. Write credentials file if env vars are provided ─────────────────────
# Credentials are removed from disk as soon as the tunnel is established.
CREDS_FILE=""
if [[ -n "${OVPN_USERNAME:-}" ]] && [[ -n "${OVPN_PASSWORD:-}" ]]; then
    CREDS_FILE=$(mktemp /tmp/ovpn-creds-XXXXXX)
    chmod 600 "${CREDS_FILE}"
    printf '%s\n%s\n' "${OVPN_USERNAME}" "${OVPN_PASSWORD}" > "${CREDS_FILE}"
    log "Credentials file written (will be removed after connect)"
fi

cleanup_creds() {
    [[ -n "${CREDS_FILE}" ]] && rm -f "${CREDS_FILE}" 2>/dev/null || true
    return
}
trap cleanup_creds EXIT

# ─── 2. Save the original default gateway before touching routes ─────────────
ORIG_GW=$(ip -4 route show default | awk '/default/{print $3; exit}')
ORIG_DEV=$(ip -4 route show default | awk '/default/{print $5; exit}')
log "Original gateway: ${ORIG_GW} dev ${ORIG_DEV}"

# ─── 3. Pin the VPN server endpoint to the original gateway ─────────────────
REMOTE_HOST=$(grep -iP '^\s*remote\s+\S+' "${OVPN_CONF}" \
              | awk '{print $2}' | head -1 || true)

if [[ -n "${REMOTE_HOST}" ]] && [[ -n "${ORIG_GW}" ]]; then
    REMOTE_IP=$(getent ahostsv4 "${REMOTE_HOST}" 2>/dev/null \
                | awk 'NR==1{print $1}' || true)
    if [[ -n "${REMOTE_IP}" ]]; then
        ip -4 route add "${REMOTE_IP}/32" via "${ORIG_GW}" dev "${ORIG_DEV}" \
            2>/dev/null || true
        log "VPN endpoint ${REMOTE_IP} (${REMOTE_HOST}) pinned via ${ORIG_GW}"
    else
        warn "Could not resolve VPN endpoint '${REMOTE_HOST}' — skipping pin"
    fi
else
    warn "No 'remote' directive found in config or no default gateway"
fi

# ─── 4. Build and launch OpenVPN ────────────────────────────────────────────
OVPN_ARGS=(
    --config   "${OVPN_CONF}"
    --dev      "${VPN_IFACE}"
    --dev-type tun
    --script-security 2
    --log /proc/1/fd/1
    --auth-nocache
)

if [[ -n "${CREDS_FILE}" ]]; then
    OVPN_ARGS+=(--auth-user-pass "${CREDS_FILE}")
fi

log "Starting OpenVPN..."
openvpn "${OVPN_ARGS[@]}" &
OVPN_PID=$!
log "OpenVPN started (PID=${OVPN_PID})"

# ─── 5. Wait for tun0 to appear ─────────────────────────────────────────────
log "Waiting for ${VPN_IFACE} interface (up to ${CONNECT_TIMEOUT}s)..."
DEADLINE=$((SECONDS + CONNECT_TIMEOUT))
TUN_UP=0
while [[ "${SECONDS}" -lt "${DEADLINE}" ]]; do
    if ip link show "${VPN_IFACE}" &>/dev/null; then
        TUN_UP=1
        log "${VPN_IFACE} interface is up"
        break
    fi
    if ! kill -0 "${OVPN_PID}" 2>/dev/null; then
        err "OpenVPN process exited before tunnel was established"
        write_health "dead" "" "OpenVPN exited before tun0 appeared"
        exit 1
    fi
    sleep 2
done

if [[ "${TUN_UP}" -eq 0 ]]; then
    err "${VPN_IFACE} did not appear within ${CONNECT_TIMEOUT}s — aborting"
    write_health "dead" "" "tun0 timeout"
    kill "${OVPN_PID}" 2>/dev/null || true
    exit 1
fi

# ─── 6. Policy routing for eth0 reply traffic ────────────────────────────────
ETH0_IP=$(ip -4 addr show eth0 2>/dev/null \
          | awk '/inet /{print $2}' | cut -d/ -f1 | head -1 || true)
if [[ -n "${ETH0_IP}" ]] && [[ -n "${ORIG_GW}" ]]; then
    ip rule add from "${ETH0_IP}" table 128 2>/dev/null || true
    ip route add default via "${ORIG_GW}" dev "${ORIG_DEV}" table 128 2>/dev/null || true
fi

# ─── 7. Remove credentials from disk ────────────────────────────────────────
cleanup_creds
CREDS_FILE=""

# ─── 8. Verify external connectivity through VPN ────────────────────────────
log "Verifying VPN connectivity through ${VPN_IFACE}..."
EXT_JSON=$(curl -sf \
           --interface "${VPN_IFACE}" \
           --max-time "${VPN_CHECK_TIMEOUT}" \
           "https://ipinfo.io/json" || echo "")

if [[ -z "${EXT_JSON}" ]]; then
    err "No connectivity through ${VPN_IFACE} — aborting to prevent IP leak"
    write_health "dead" "" "initial VPN check failed — no connectivity through tun0"
    kill "${OVPN_PID}" 2>/dev/null || true
    exit 1
fi

EXT_IP=$(echo "${EXT_JSON}" | grep -o '"ip"[^,]*' | grep -o '[0-9.]*' | head -1)
EXT_COUNTRY=$(echo "${EXT_JSON}" | grep -o '"country"[^,]*' | sed 's/.*"\(.*\)".*/\1/')

# Sanity: VPN IP must NOT be a private/Docker address
if echo "${EXT_IP}" | grep -qP '^(172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|10\.)'; then
    err "External IP ${EXT_IP} is a private address — VPN routing not working"
    write_health "dead" "${EXT_IP}" "VPN IP is a private address"
    kill "${OVPN_PID}" 2>/dev/null || true
    exit 1
fi

log "VPN active — External IP: ${EXT_IP}  Country: ${EXT_COUNTRY}"
write_health "healthy" "${EXT_IP}" "VPN verified at startup"

# ─── 9. Start aria2 — bound to 127.0.0.1 only ──────────────────────────────
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

# ─── 10. Kill-switch + runtime health monitor ───────────────────────────────
# Checks:
#   a) tun0 interface exists
#   b) External IP through tun0 is still a VPN IP (periodic)
#
# On failure: SIGTERM → 10s → SIGKILL; writes /tmp/ks_triggered for host watchdog.

LAST_HEALTH_CHECK=0

kill_switch() {
    while kill -0 "${ARIA2_PID}" 2>/dev/null; do
        sleep "${KILL_SWITCH_INTERVAL}"
        local reason=""

        # (a) Interface existence
        if ! ip link show "${VPN_IFACE}" &>/dev/null; then
            reason="${VPN_IFACE} interface disappeared"
        fi

        # (b) Periodic external IP re-verification
        if [[ -z "${reason}" ]]; then
            local now
            now=$(date +%s)
            if [[ $(( now - LAST_HEALTH_CHECK )) -ge "${HEALTH_CHECK_INTERVAL}" ]]; then
                LAST_HEALTH_CHECK=${now}
                local live_json
                live_json=$(curl -sf \
                            --interface "${VPN_IFACE}" \
                            --max-time 8 \
                            "https://ipinfo.io/json" 2>/dev/null || echo "")
                if [[ -z "${live_json}" ]]; then
                    reason="runtime IP check failed — no connectivity through ${VPN_IFACE}"
                else
                    local live_ip
                    live_ip=$(echo "${live_json}" | grep -o '"ip"[^,]*' | grep -o '[0-9.]*' | head -1)
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

            # Signal host watchdog
            echo "${reason}" > /tmp/ks_triggered
            sync

            # Graceful shutdown: SIGTERM → 10s → SIGKILL
            log "Sending SIGTERM to aria2 (PID=${ARIA2_PID}) for graceful session save..."
            kill -15 "${ARIA2_PID}" 2>/dev/null || true
            local waited=0
            while kill -0 "${ARIA2_PID}" 2>/dev/null && [[ "${waited}" -lt 10 ]]; do
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
    return
}

kill_switch &
MONITOR_PID=$!

# ─── 11. Wait for aria2 to exit ─────────────────────────────────────────────
wait "${ARIA2_PID}" || true
log "aria2 exited — shutting down"
write_health "stopped" "" "aria2 exited"
kill "${MONITOR_PID}" 2>/dev/null || true
kill "${OVPN_PID}"    2>/dev/null || true
ip link delete dev "${VPN_IFACE}" 2>/dev/null || true
