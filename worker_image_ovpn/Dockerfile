FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241

# Install OpenVPN, aria2, and networking utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    openvpn \
    aria2 \
    curl \
    iproute2 \
    iptables \
    procps \
    ca-certificates \
    dnsutils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY startup.sh /app/startup.sh
RUN chmod +x /app/startup.sh

# No VOLUME declarations: they created anonymous volumes that accumulate on
# every mule teardown. /downloads and /etc/openvpn are supplied as explicit bind
# mounts by cli/docker_client.start_mule.

# aria2 JSON-RPC port
EXPOSE 6800

# Reports unhealthy the moment the mule stops being able to egress through the
# tunnel: the startup script keeps /tmp/vpn_health.json current, and writes
# /tmp/ks_triggered when the kill-switch fires.
HEALTHCHECK --interval=30s --timeout=8s --start-period=90s --retries=2 \
    CMD test ! -f /tmp/ks_triggered \
        && grep -q '"status":"healthy"' /tmp/vpn_health.json || exit 1

CMD ["/app/startup.sh"]
