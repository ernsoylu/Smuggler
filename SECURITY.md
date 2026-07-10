# Security Policy

Smuggler routes each torrent download through an isolated, VPN-tunnelled Docker
container (a **mule**) so that the downloader's identity and the host's real IP
are never exposed to trackers or peers. This document describes the threat model,
the controls that enforce it, how to operate Smuggler safely, and how to report a
vulnerability.

---

## Threat model

**What Smuggler is designed to prevent**

- **Real-IP leaks** to trackers/peers if a VPN tunnel drops, mis-routes, or was
  never fully established.
- **DNS leaks** that reveal what a mule is resolving to the host's ISP/resolver.
- **IPv6 leaks** around an IPv4-only tunnel.
- **Unauthenticated control** of the stack (which holds the Docker socket).
- **Secret exposure at rest** — WireGuard private keys, OpenVPN credentials.

**Trust assumptions**

- The **host is trusted and single-tenant.** Anyone with host access (a shell,
  the Docker socket, or root) can bypass every control here. Smuggler protects
  against network exposure and tunnel failure, not against a compromised host.
- The **VPN provider is trusted** to the extent that it sees your traffic egress.
  Smuggler hides the *host's* identity from peers, not your activity from the VPN.
- The mules run **untrusted torrent data** through aria2; they are treated as the
  least-trusted component and are confined accordingly.

**Out of scope**

- De-anonymisation by the VPN provider or by traffic-correlation adversaries.
- Malicious host, malicious container image supply chain, or kernel exploits.
- Application-layer attacks in downloaded content.

---

## Identity-protection controls (no-leak)

| Control | Mechanism |
|--------|-----------|
| **VPN-first** | aria2 does not start until the mule has verified an external IP through the tunnel (`worker_image*/startup.sh`, `cli/docker_client.wait_for_vpn`). |
| **Full-tunnel routing** | WireGuard: `ip route replace default dev wg0`. OpenVPN: `--redirect-gateway def1` forces all traffic through `tun0` regardless of what the `.ovpn` ships (so a config lacking `redirect-gateway` cannot silently leak). |
| **Firewall kill-switch** | Each mule installs `iptables` rules on the real NIC that permit only VPN transport to the pinned endpoint and aria2 RPC replies (`--sport 6800`), and **drop everything else**. If the tunnel dies, traffic is dropped, not leaked — independent of any timer. |
| **Real-egress verification** | Health checks probe both the tunnel interface *and* the default route (the path aria2 actually uses) and flag a leak on mismatch — closing the blind spot where an interface-bound check passes while real traffic egresses elsewhere (`check_mule_vpn`, both `startup.sh` monitors). |
| **DNS lock** | `/etc/resolv.conf` is pinned to the VPN/public resolvers (reached through the tunnel) and Docker's embedded resolver (`127.0.0.11`) is firewalled, so a query can never egress via the host. |
| **IPv6 block** | For IPv4-only tunnels, IPv6 egress on the real NIC is dropped (link-local excepted). |
| **App-level monitor + watchdog** | The in-container monitor tracks interface existence and WireGuard handshake freshness and tears down aria2 on failure; the host watchdog (`api/watchdog.py`) evacuates torrents to a healthy mule and kills a compromised one. An `ip_leak` verdict evacuates on the first failed sweep. |

The firewall kill-switch is the **primary** no-leak guarantee. The monitors and
watchdog are secondary (detection and recovery), so a leak cannot occur merely
because a poll interval hasn't elapsed.

---

## System-security controls

| Control | Mechanism |
|--------|-----------|
| **Loopback by default** | The API binds `SMG_API_BIND` (default `127.0.0.1:55555`) and the UI listens on `127.0.0.1:8887`. The API holds the Docker socket, so it is not reachable from the LAN unless deliberately exposed. |
| **Optional token auth** | Setting `SMG_API_TOKEN` requires a matching `X-Smuggler-Token` header on every `/api/*` call (`api/app.py`). The web UI injects it via nginx; the desktop client sends it from the environment. Health checks and CORS preflight are exempt. |
| **CSRF guard** | State-changing requests that carry a browser `Origin` outside the allow-list are refused (403), so a page the user visits cannot drive the local API. |
| **Least-privilege mules** | WireGuard mules run with `NET_ADMIN` only — **no `CAP_SYS_MODULE`** (which would allow loading modules into the host kernel). The host must provide the `wireguard` module (`setup.sh` loads and persists it). OpenVPN mules add only `/dev/net/tun`. |
| **aria2 RPC on loopback** | The per-mule RPC port is published to `127.0.0.1:<ephemeral>` and gated by a 192-bit random token (`secrets.token_urlsafe(24)`). |
| **Input restriction** | `addUri` accepts `magnet:` URIs only (no `http`/`ftp`/`file` SSRF vector); file deletion is confined to the downloads root with a resolve-and-containment check. |
| **Encryption at rest** | OpenVPN passwords **and** VPN config bodies (WireGuard private keys, inline OpenVPN keys) are Fernet-encrypted, keyed off `SMG_SECRET_KEY` (`api/crypto.py`). Ciphertext carries a `fernet:` prefix; legacy plaintext rows are migrated in place on `init_db`. Encrypt/decrypt live in `api/database.py` so callers only ever see plaintext. |

---

## Operational security

### 1. Set and protect `SMG_SECRET_KEY`

`setup.sh` generates a high-entropy key into `.env` and `chmod 600`s the file.
This key encrypts every stored VPN secret.

- **Keep it stable and private.** Changing or losing it makes existing encrypted
  configs/passwords **unrecoverable** — you would have to delete and re-upload.
- The key and the database live on the same host, so encryption-at-rest primarily
  defends against **database-only exfiltration** (e.g. a leaked backup), not
  against an attacker who already has host access.
- The key derivation is an unsalted SHA-256 of `SMG_SECRET_KEY` (no stretching),
  which is appropriate for the generated high-entropy value but weak for a
  hand-chosen passphrase — keep the generated key.

### 2. Enable the API token (recommended)

Uncomment `SMG_API_TOKEN` in `.env` (a value is pre-generated in the comment).
`docker compose up` passes it to both the API and the UI, so the browser UI keeps
working via nginx injection. For the desktop client, export the same value:

```bash
export SMG_API_TOKEN=...   # same value as .env
```

### 3. Exposing beyond loopback

The loopback default is the safe posture. If you must reach the UI/API from
another machine, do **not** simply widen the bind — put it behind a reverse proxy
that terminates TLS and authenticates, and then:

- set `SMG_API_TOKEN`, **and**
- add your real UI origin to `SMG_CORS_ORIGINS` (e.g.
  `SMG_CORS_ORIGINS=https://smuggler.example.com`), or the CSRF guard will reject
  your own UI's writes with `403`.

### 4. The Docker socket

The API container mounts `/var/run/docker.sock` because it manages mule
containers — this makes the API process **host-root-equivalent.** It is mitigated
by the loopback bind and optional token, not eliminated. Any remote-code-execution
in the API or its dependencies escalates to host root, so keep the API off the LAN
and keep dependencies patched.

---

## Verifying a deployment does not leak

After `./start.sh build` and deploying a mule, confirm the following (replace
`<mule>` with the container name from `smg mule list` / `GET /api/mules/`):

```bash
# 1. aria2's default route goes through the tunnel (dev wg0 / tun0)
docker exec <mule> ip route show default
docker exec <mule> ip route show 0.0.0.0/1        # OpenVPN: dev tun0

# 2. Default-route exit IP == tunnel-bound exit IP (no mis-route)
docker exec <mule> curl -s https://icanhazip.com                    # default route
docker exec <mule> curl -s --interface wg0 https://icanhazip.com    # tunnel (tun0 for OpenVPN)

# 3. The kill-switch DROP is present on the real NIC
docker exec <mule> iptables -S OUTPUT | grep -E 'sport 6800|DROP'

# 4. DNS is locked and Docker's resolver is blocked
docker exec <mule> cat /etc/resolv.conf
docker exec <mule> iptables -S OUTPUT | grep 127.0.0.11

# 5. The control plane is not on the LAN (run from another host — must fail)
curl --max-time 3 http://<host-lan-ip>:55555/api/health/
```

**Kill-switch drill** — bring the tunnel down and confirm downloads stop rather
than leak, and that the mule is torn down:

```bash
docker exec <mule> ip link set wg0 down        # WireGuard (or: pkill openvpn)
docker exec <mule> curl -s --max-time 5 https://icanhazip.com    # should FAIL (dropped)
docker exec <mule> cat /tmp/ks_triggered       # kill-switch reason recorded
curl http://127.0.0.1:55555/api/mules/<mule>/health   # reports unhealthy → watchdog evacuates
```

---

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

- Preferred: open a private **GitHub Security Advisory** on the repository
  (*Security → Advisories → Report a vulnerability*).
- Include a description, affected component/version, reproduction steps, and the
  impact (especially anything that could leak the real IP or bypass authentication).

You can expect an initial acknowledgement within a few days. Please allow a
reasonable window for a fix before any public disclosure.

> Maintainers: replace the reporting channel above with a monitored security
> contact (email or advisory link) before publishing this repository.

---

## Supported versions

Smuggler is pre-1.0 and single-track; only the latest `main` receives security
fixes.
