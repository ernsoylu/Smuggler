FROM debian:bookworm-slim

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

# Shared downloads volume and WireGuard config volume
VOLUME ["/downloads", "/etc/wireguard"]

# aria2 JSON-RPC port
EXPOSE 6800

CMD ["/app/startup.sh"]
