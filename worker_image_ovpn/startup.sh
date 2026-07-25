#!/bin/bash
# OpenVPN mule startup script — VPN-first, no-leak policy.
#
# Security measures:
#   • curl VPN check bound to tun0 (--interface)
#   • aria2's RPC listens on the container interface (Docker port publishing
#     DNATs to it, so loopback-only would be unreachable); ingress on the real
#     NIC is firewalled to the Docker gateway so bridge peers cannot reach it
#   • Credentials deleted from disk immediately after tunnel established
#   • Periodic runtime IP re-verification every HEALTH_CHECK_INTERVAL seconds
#   • Kill-switch: SIGTERM → 10s grace → SIGKILL; writes /tmp/ks_triggered
#   • Writes /tmp/vpn_health.json for host watchdog
#
# Fail-closed policy: if no endpoint can be pinned or any firewall rule cannot
# be installed, the mule aborts instead of running unprotected. This matters
# more here than for WireGuard — 'redirect-gateway def1' makes the tunnel work
# fine without a pin, so an unarmed kill-switch stays invisible until tun0 dies
# and OpenVPN restores the clear-net default route.
set -euo pipefail

ARIA2_SECRET="${ARIA2_SECRET:-}"
# uid/gid aria2 runs as. Defaults to root only when the caller supplies nothing
# (cli/docker_client always does), which keeps a bare `docker run` working.
PUID="${PUID:-0}"
PGID="${PGID:-0}"
OVPN_CONF="/etc/openvpn/client.ovpn"
VPN_IFACE="tun0"
VPN_CHECK_TIMEOUT=30      # seconds to wait for ipinfo.io response
CONNECT_TIMEOUT=60        # seconds to wait for tun0 to appear
KILL_SWITCH_INTERVAL=5
HEALTH_CHECK_INTERVAL=30  # seconds between runtime IP re-verifications

log()  { echo "[$(date -u +%T)] $*"; return; }
warn() { echo "[$(date -u +%T)] WARN  $*"; return; }
err()  { echo "[$(date -u +%T)] ERROR $*" >&2; return; }

# ─── Health status file (read by host watchdog + deploy progress) ─────────────
# PHASE tracks how far startup has actually got, so the UI can show real
# progress instead of guessing from elapsed time. It only advances during
# startup; once the tunnel is verified it stays at "deployed".
PHASE="starting"

write_health() {
    local status="$1" ip="${2:-}" reason="${3:-}"
    printf '{"status":"%s","phase":"%s","ip":"%s","reason":"%s","ts":"%s"}\n' \
        "$status" "$PHASE" "$ip" "$reason" "$(date -u +%FT%TZ)" \
        > /tmp/vpn_health.json
    return
}

set_phase() {
    PHASE="$1"
    log "phase → $1"
    write_health "starting" "" "${2:-$1}"
    return
}
write_health "starting" "" "initialising"

# ─── 0. Refuse to run without a real RPC secret ──────────────────────────────
# A predictable secret plus a reachable RPC port is unauthenticated download
# control, so this is fatal rather than defaulted.
if [[ -z "${ARIA2_SECRET}" ]] || [[ "${ARIA2_SECRET}" == "changeme" ]]; then
    err "FATAL: ARIA2_SECRET is unset or a placeholder — refusing to start."
    write_health "dead" "" "ARIA2_SECRET missing or placeholder"
    exit 1
fi

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

# Both are load-bearing for the kill-switch below (they identify the interface
# to seal and the only host allowed to reach the RPC), so validate them here
# rather than letting a later rule fail obscurely.
if [[ -z "${ORIG_GW}" ]] || [[ -z "${ORIG_DEV}" ]]; then
    err "FATAL: could not determine the default gateway/interface —"
    err "the kill-switch cannot be armed, so aria2 will not be started."
    write_health "dead" "" "no default route — kill-switch cannot be armed"
    exit 1
fi

# ─── 3. Pin the VPN server endpoint(s) to the original gateway ──────────────
# Configs routinely list several 'remote' lines for failover, so pin every one
# of them: a kill-switch that whitelists only the first would block OpenVPN the
# moment it fails over to the second.
mapfile -t REMOTE_HOSTS < <(grep -iP '^\s*remote\s+\S+' "${OVPN_CONF}" \
                            | awk '{print $2}' | sort -u || true)
REMOTE_IPS=()

for remote_host in "${REMOTE_HOSTS[@]}"; do
    [[ -z "${remote_host}" ]] && continue
    remote_ip=$(getent ahostsv4 "${remote_host}" 2>/dev/null \
                | awk 'NR==1{print $1}' || true)
    if [[ -z "${remote_ip}" ]]; then
        warn "Could not resolve VPN endpoint '${remote_host}'"
        continue
    fi
    REMOTE_IPS+=("${remote_ip}")
    ip -4 route add "${remote_ip}/32" via "${ORIG_GW}" dev "${ORIG_DEV}" \
        2>/dev/null || true
    log "VPN endpoint ${remote_ip} (${remote_host}) pinned via ${ORIG_GW}"
done

# Fail closed before OpenVPN is even launched: with no resolvable endpoint the
# kill-switch in 6b cannot be armed, and 'redirect-gateway def1' would happily
# bring up a tunnel whose failure mode is a silent clear-net leak.
if [[ ${#REMOTE_IPS[@]} -eq 0 ]]; then
    err "FATAL: no VPN endpoint in ${OVPN_CONF} could be resolved."
    err "Without a pinned endpoint the kill-switch cannot be armed, so this mule"
    err "will not be started. Check the 'remote' lines and DNS from the host."
    write_health "dead" "" "no endpoint resolvable — kill-switch cannot be armed"
    exit 1
fi

# ─── 4. Build and launch OpenVPN ────────────────────────────────────────────
OVPN_ARGS=(
    --config   "${OVPN_CONF}"
    --dev      "${VPN_IFACE}"
    --dev-type tun
    --script-security 2
    # Force ALL traffic through the tunnel regardless of what the .ovpn ships.
    # Without this, a config lacking redirect-gateway leaves the default route on
    # eth0 and aria2 leaks the real IP — and the tun0-bound checks would not
    # notice. 'def1' uses 0.0.0.0/1 + 128.0.0.0/1 so the endpoint stays reachable.
    --redirect-gateway def1
    --log /proc/1/fd/1
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
        set_phase configuring "tunnel interface up, applying DNS and routing"
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

# ─── 6b. DNS lock, IPv6 block, and firewall kill-switch ─────────────────────
# The default route goes through tun0 (--redirect-gateway def1). Close the
# remaining leak paths on the real NIC: DNS and any fallback egress.

# DNS: prefer the config's pushed DNS, else public resolvers — both via tun0.
# Block Docker's embedded resolver (127.0.0.11) so a query can never egress via
# the host/eth0 and reveal what the mule is resolving (identity correlation).
OVPN_DNS=$(grep -iP 'dhcp-option\s+DNS' "${OVPN_CONF}" 2>/dev/null \
           | grep -oP '[0-9]+(\.[0-9]+){3}' | head -1 || true)
if [[ -n "${OVPN_DNS}" ]]; then
    printf "nameserver %s\nnameserver 1.1.1.1\nnameserver 8.8.8.8\n" "${OVPN_DNS}" > /etc/resolv.conf
    log "DNS locked to VPN DNS (${OVPN_DNS}) + public fallbacks (via ${VPN_IFACE})"
else
    printf "nameserver 1.1.1.1\nnameserver 8.8.8.8\n" > /etc/resolv.conf
    log "DNS locked to public resolvers (via ${VPN_IFACE})"
fi
iptables -A OUTPUT -d 127.0.0.11 -p udp --dport 53 -j REJECT 2>/dev/null || true
iptables -A OUTPUT -d 127.0.0.11 -p tcp --dport 53 -j REJECT 2>/dev/null || true

# IPv6: this tunnel carries IPv4 only — block IPv6 egress on the real NIC so v6
# traffic (including BitTorrent/DHT over v6) cannot bypass the tunnel.
ip6tables -A OUTPUT -o "${ORIG_DEV}" -d fe80::/10 -j ACCEPT 2>/dev/null || true
ip6tables -A OUTPUT -o "${ORIG_DEV}" -j DROP 2>/dev/null || true

# Firewall kill-switch on the real NIC — the PRIMARY no-leak guarantee (see
# SECURITY.md): permit only VPN transport to the pinned endpoints and aria2 RPC
# traffic; drop everything else. If tun0 dies (OpenVPN also restores the eth0
# default route on exit), traffic is dropped here instead of leaking the real IP
# during the window before the monitor reacts.
#
# Every step is fatal on failure. Endpoint resolution already fell over in
# step 3, so REMOTE_IPS is non-empty by construction here.
arm_or_die() {
    # Install one firewall rule, or abort the mule. Unlike the best-effort rules
    # above, these define the leak boundary — a mule running without them is
    # exactly the failure mode the kill-switch exists to prevent.
    if ! iptables "$@"; then
        err "FATAL: could not install kill-switch rule: iptables $*"
        write_health "dead" "" "kill-switch rule install failed"
        kill "${OVPN_PID}" 2>/dev/null || true
        exit 1
    fi
    return 0
}

# Egress: RPC replies and VPN transport only.
arm_or_die -A OUTPUT -o "${ORIG_DEV}" -p tcp --sport 6800 -j ACCEPT
for remote_ip in "${REMOTE_IPS[@]}"; do
    arm_or_die -A OUTPUT -o "${ORIG_DEV}" -d "${remote_ip}" -j ACCEPT
done
arm_or_die -A OUTPUT -o "${ORIG_DEV}" -j DROP

# Ingress: aria2's RPC has to listen on the container interface for Docker's
# published port to reach it, which also exposes it to every container sharing
# this bridge. Restrict it on the egress NIC to the gateway (the host) and drop
# the rest. Scoped to port 6800 so BitTorrent peer traffic over tun0 is untouched.
#
# Two callers reach the RPC, by different paths:
#   - host tooling (smg CLI, ./start.sh debug) via the published loopback port,
#     which arrives on ${ORIG_DEV} from ${ORIG_GW} and is accepted below;
#   - the API container over the internal smuggler-rpc network, which arrives on
#     a different interface these rules do not match. That interface is attached
#     after this script runs, so it deliberately is not named here.
# Sibling mules also sit on smuggler-rpc, so reachability there is gated by each
# mule's own 192-bit RPC token rather than by the firewall.
arm_or_die -A INPUT -i "${ORIG_DEV}" -p tcp --dport 6800 -s "${ORIG_GW}" -j ACCEPT
arm_or_die -A INPUT -i "${ORIG_DEV}" -p tcp --dport 6800 -j DROP

log "Kill-switch armed: only VPN endpoints ${REMOTE_IPS[*]} + RPC allowed on ${ORIG_DEV}"
log "RPC ingress restricted to gateway ${ORIG_GW}"
set_phase connecting "kill-switch armed, verifying the tunnel"

# ─── 7. Remove credentials from disk ────────────────────────────────────────
cleanup_creds
CREDS_FILE=""

# ─── 8. Verify external connectivity through VPN ────────────────────────────
log "Verifying VPN connectivity through ${VPN_IFACE}..."

EXT_IP=""
EXT_COUNTRY=""
MAX_RETRIES=15
RETRY_COUNT=0
DELAY=4

while [[ -z "${EXT_IP}" ]] && [[ "${RETRY_COUNT}" -lt "${MAX_RETRIES}" ]]; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    log "Check ${RETRY_COUNT}/${MAX_RETRIES}: hitting ipinfo.io..."

    EXT_JSON=$(curl -sf \
               --interface "${VPN_IFACE}" \
               --max-time 15 \
               "https://ipinfo.io/json" || echo "")

    if [[ -n "${EXT_JSON}" ]]; then
        EXT_IP=$(echo "${EXT_JSON}"      | grep -o '"ip"[^,]*'      | grep -o '[0-9.]*'   | head -1 || echo "")
        EXT_COUNTRY=$(echo "${EXT_JSON}" | grep -o '"country"[^,]*' | sed 's/.*"\(.*\)".*/\1/' || echo "")
        break
    else
        warn "Curl failed (DNS delay or tunnel stabilizing). Retrying in ${DELAY}s..."
        sleep "${DELAY}"
    fi
done

if [[ -z "${EXT_IP}" ]]; then
    err "FATAL: Permanent connectivity failure through ${VPN_IFACE}"
    err "DIAGNOSTICS:"
    err "$(ip -4 addr show "${VPN_IFACE}" 2>&1 || true)"
    err "$(ip -4 route show 2>&1 || true)"
    err "resolv.conf: $(cat /etc/resolv.conf || true)"

    write_health "dead" "" "initial VPN check failed — no connectivity through tun0"
    kill "${OVPN_PID}" 2>/dev/null || true
    exit 1
fi

# Sanity: VPN IP must NOT be a private/Docker address
if echo "${EXT_IP}" | grep -qP '^(172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|10\.)'; then
    err "External IP ${EXT_IP} is a private address — VPN routing not working"
    write_health "dead" "${EXT_IP}" "VPN IP is a private address"
    kill "${OVPN_PID}" 2>/dev/null || true
    exit 1
fi

log "VPN active — External IP: ${EXT_IP}  Country: ${EXT_COUNTRY}"
PHASE="deployed"
write_health "healthy" "${EXT_IP}" "VPN verified at startup"

# ─── 9. Start aria2 ─────────────────────────────────────────────────────────
# --rpc-listen-all=true is required, not an oversight: Docker's published port
# DNATs to the container's address, so a loopback-only listener would be
# unreachable and aria2 has no bind-address option. Ingress is constrained by
# the INPUT rules armed in 6b instead. CORS stays off — the Flask API proxies
# RPC server-side, so no browser ever talks to aria2 directly.
# ─── Privilege drop for aria2 ────────────────────────────────────────────────
# Everything above needs root (ip, iptables, wg/openvpn). aria2 itself needs no
# capabilities once the tunnel is up, and running it as root made every
# downloaded file root-owned on the host. Resolve the prefix here so a failure
# is reported before aria2 starts rather than as a confusing write error later.
ARIA2_PREFIX=()
if [[ "${PUID}" != "0" ]]; then
    if ! command -v setpriv >/dev/null 2>&1; then
        err "FATAL: setpriv missing — cannot drop privileges to ${PUID}:${PGID}."
        write_health "dead" "" "setpriv unavailable for privilege drop"
        exit 1
    fi
    if ! setpriv --reuid="${PUID}" --regid="${PGID}" --clear-groups \
         test -w /downloads 2>/dev/null; then
        err "FATAL: uid ${PUID} cannot write to /downloads."
        err "Set SMG_PUID/SMG_PGID to a user that owns the downloads directory."
        write_health "dead" "" "downloads not writable by uid ${PUID}"
        exit 1
    fi
    ARIA2_PREFIX=(setpriv --reuid="${PUID}" --regid="${PGID}" --clear-groups --)
    log "aria2 will run as ${PUID}:${PGID} (downloads stay user-owned)"
else
    warn "PUID unset — aria2 runs as root and downloads will be root-owned"
fi

log "Starting aria2 RPC daemon (RPC ingress firewalled to ${ORIG_GW})..."
"${ARIA2_PREFIX[@]}" aria2c \
    --dir=/downloads \
    --enable-rpc=true \
    --rpc-listen-all=true \
    --rpc-listen-port=6800 \
    --rpc-secret="${ARIA2_SECRET}" \
    --rpc-allow-origin-all=false \
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
                # Use icanhazip.com for health check as it's not aggressively rate-limited
                local live_ip
                live_ip=$(curl -s -4 --interface "${VPN_IFACE}" --max-time 10 "https://icanhazip.com" | tr -d '[:space:]' || echo "")
                # Probe via the default route too (the path aria2 actually uses).
                # A mismatch means traffic is exiting somewhere other than tun0.
                local route_ip
                route_ip=$(curl -s -4 --max-time 10 "https://icanhazip.com" | tr -d '[:space:]' || echo "")

                if [[ -z "${live_ip}" ]]; then
                    reason="runtime IP check failed — no connectivity through ${VPN_IFACE}"
                elif echo "${live_ip}" | grep -qP '^(172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|10\.)'; then
                    reason="IP leak detected: external IP ${live_ip} is a private address"
                elif [[ -n "${route_ip}" && "${route_ip}" != "${live_ip}" ]]; then
                    reason="IP leak detected: default-route exit ${route_ip} != VPN exit ${live_ip}"
                else
                    write_health "healthy" "${live_ip}" "periodic check OK"
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
kill "${MONITOR_PID}" 2>/dev/null || true
kill "${OVPN_PID}"    2>/dev/null || true
ip link delete dev "${VPN_IFACE}" 2>/dev/null || true

# Distinguish a kill-switch teardown from a clean aria2 exit. Without this the
# "stopped" status overwrites the kill-switch reason and the container exits 0,
# so neither the host watchdog nor an operator can tell a leak-abort apart from
# a normal shutdown.
if [[ -f /tmp/ks_triggered ]]; then
    err "aria2 terminated by kill-switch: $(cat /tmp/ks_triggered)"
    exit 1
fi

log "aria2 exited — shutting down"
write_health "stopped" "" "aria2 exited"
