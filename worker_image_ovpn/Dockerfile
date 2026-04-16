FROM debian:bookworm-slim

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

# Shared downloads volume and OpenVPN config volume
VOLUME ["/downloads", "/etc/openvpn"]

# aria2 JSON-RPC port
EXPOSE 6800

CMD ["/app/startup.sh"]
