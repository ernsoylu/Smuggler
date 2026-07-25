FROM debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818

# Install WireGuard, aria2, and networking utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    wireguard-tools \
    openresolv \
    aria2 \
    curl \
    iproute2 \
    iptables \
    procps \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY startup.sh /app/startup.sh
RUN chmod +x /app/startup.sh

# No VOLUME declarations: they created anonymous volumes that accumulate on
# every mule teardown. /downloads and /etc/wireguard are supplied as explicit bind
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
