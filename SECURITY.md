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
- **Unauthenticated control** of the stack (which can drive Docker).
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
| **Firewall kill-switch** | Each mule installs `iptables` rules on the real NIC that permit only VPN transport to the pinned endpoint(s) and aria2 RPC replies (`--sport 6800`), and **drop everything else**. If the tunnel dies, traffic is dropped, not leaked — independent of any timer. **Fail-closed:** if no endpoint can be resolved, or any rule fails to install, the mule aborts instead of starting unprotected. OpenVPN configs with several `remote` lines have every endpoint pinned, so failover is not blocked. |
| **RPC ingress filter** | aria2's RPC must listen on the container interface (Docker's published port DNATs to it, and aria2 has no bind-address option), so `INPUT` rules restrict port 6800 on the real NIC to the Docker gateway — containers sharing the bridge cannot reach it. CORS is off (`--rpc-allow-origin-all=false`); the API proxies RPC server-side. |
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
| **Loopback by default** | Compose publishes the API to `127.0.0.1:55555` and the UI to `127.0.0.1:8887`. Both bind all interfaces *inside* their container (a published port cannot reach a loopback-bound listener), so the port mapping is what keeps them off the LAN. The API can drive Docker (via the proxy below), so it must not be exposed. |
| **No host networking** | The API and UI run on Docker bridge networks, not in the host's network namespace. `smuggler-net` carries UI↔API; `smuggler-rpc` is an **internal** network (no gateway, hence no default route and no egress) carrying only aria2 RPC between the API and the mules. Mules join it as a second interface, so the interface the kill-switch seals — the one holding the default route — is unchanged. |
| **Token auth (mandatory in the compose topology)** | `setup.sh` generates `SMG_API_TOKEN` into `.env` and enables it, so every `/api/*` call needs a matching `X-Smuggler-Token` header (`api/app.py`). Only `/api/health` (exact path) and CORS preflight are exempt. Because mules share `smuggler-rpc` with the API they can open connections to it — something host networking used to prevent — so the API **refuses to start** without a token when `SMG_MULE_RPC_HOST=container`. The token is what stops a compromised mule from driving the Docker socket. |
| **CSRF guard** | State-changing requests that carry a browser `Origin` outside the allow-list are refused (403), so a page the user visits cannot drive the local API. |
| **Filtered Docker access** | The API reaches Docker through `smuggler-docker-proxy` (digest-pinned, socket mounted read-only) over an `internal` network, instead of mounting the socket itself. Only PING/VERSION/CONTAINERS/NETWORKS/POST/EXEC are enabled; images, volumes, secrets, swarm, plugins and the system endpoints return 403. Mules are on a different network and cannot reach the proxy. Surface reduction, **not** a trust boundary — see "The Docker socket" below. |
| **Least-privilege mules** | Mules start from `cap_drop: ALL` and add back only `NET_ADMIN`, `DAC_OVERRIDE`, `SETUID`, `SETGID` and `KILL` — each verified load-bearing by running without it. **No `CAP_SYS_MODULE`** (host-kernel module loading) and **no `NET_RAW`** (packet crafting/sniffing). `no-new-privileges` blocks setuid escalation, and `mem_limit`/`pids_limit` bound a runaway or hostile download. The host must provide the `wireguard` module (`setup.sh` loads and persists it). OpenVPN mules add only `/dev/net/tun`. |
| **Downloads are not root-owned** | aria2 drops to `PUID:PGID` via `setpriv` once the tunnel is up and the firewall is armed, so files land on the host owned by the user instead of uid 0. The default is taken from the **owner of the downloads directory**, not the calling process — inside the API container that process is root, which would silently skip the drop. Override with `SMG_PUID`/`SMG_PGID`. The mule refuses to start if that uid cannot write to `/downloads`. Root is still required for the setup phase — `ip`, `iptables`, `wg`/`openvpn` — and the kill-switch monitor keeps `CAP_KILL` so it can still tear down a non-root aria2. |
| **Unprivileged web container** | The UI is built on `nginx-unprivileged` and runs as uid 101 on port 8080 (published to `127.0.0.1:8887`), so the container facing the browser holds no root at all — stock nginx starts as root to bind `:80` and only drops its workers. |
| **Image provenance** | All four images pin their base by **digest**, not tag, so a rebuild cannot silently pull different content, and the image build itself runs `npm ci --ignore-scripts` so no dependency lifecycle script executes. Every image declares a `HEALTHCHECK`; a mule reports unhealthy as soon as `/tmp/ks_triggered` appears or its health file stops saying `healthy`. |
| **Supply-chain scanning** | CI runs `pip-audit` against the resolved lock file, `npm audit` (production advisories fail the build), Trivy CVE scans of all four images, Trivy IaC scanning, and emits a CycloneDX SBOM — weekly as well as on change. Dependabot keeps Python, npm, Actions and the digest-pinned bases moving. |
| **aria2 RPC reachability** | The containerised API reaches each mule by container name over `smuggler-rpc`. A loopback publish (`127.0.0.1:<ephemeral>`) is kept because the `smg` CLI and `./start.sh debug` run on the host and talk to aria2 directly. Both paths are gated by a 192-bit random token (`secrets.token_urlsafe(24)`); the mule refuses to start if that token is missing or a placeholder. Sibling mules also sit on `smuggler-rpc`, so mule-to-mule RPC is gated by that per-mule token rather than by the firewall. |
| **Input restriction** | `addUri` accepts `magnet:` URIs only (no `http`/`ftp`/`file` SSRF vector); file deletion is confined to the downloads root with a resolve-and-containment check. |
| **Encryption at rest** | OpenVPN passwords **and** VPN config bodies (WireGuard private keys, inline OpenVPN keys) are Fernet-encrypted with a key derived by **scrypt** (N=2¹⁴) from `SMG_SECRET_KEY` + `SMG_SECRET_SALT` (`api/crypto.py`). A `MultiFernet` chain keeps the legacy unsalted-SHA-256 key readable, and `init_db` rotates those rows onto scrypt in place. Ciphertext carries a `fernet:` prefix; pre-encryption plaintext rows are migrated on `init_db` too. Encrypt/decrypt live in `api/database.py` so callers only ever see plaintext. **Fail-closed:** storing a secret with no key raises and the upload is refused with `503`; set `SMG_ALLOW_PLAINTEXT_SECRETS=1` to deliberately opt out. |

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
- Key derivation is **scrypt** (N=2¹⁴, r=8, p=1) over `SMG_SECRET_KEY` and
  `SMG_SECRET_SALT`. The original scheme was an unsalted SHA-256, which could be
  brute-forced at raw hash speed against a captured row; scrypt makes offline
  guessing impractical even for a hand-chosen passphrase. The API still warns at
  startup if the key looks weak — prefer the generated one.
- Existing ciphertext keeps working: both keys live in a `MultiFernet`, and
  `init_db` rotates SHA-256 rows onto scrypt in place on first start. The
  rotation is idempotent and skips rows that are already current.
- `SMG_SECRET_SALT` is written only for **fresh** installs, so upgrading an
  existing deployment keeps using the built-in default salt and nothing becomes
  unreadable. It is not secret, but like the key it must stay stable — losing or
  changing either makes encrypted secrets unrecoverable. Back it up with `.env`.

### 2. The API token (enabled by default)

`setup.sh` generates `SMG_API_TOKEN` into `.env` and leaves it **active** — the
API can drive Docker, so authenticating it is the safer default.
`docker compose up` passes it to both the API and the UI, so the browser UI keeps
working via nginx injection. For the `smg` CLI, export the same value:

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

The API no longer mounts `/var/run/docker.sock`. It talks to
`smuggler-docker-proxy` (Tecnativa's socket proxy, digest-pinned) over an
`internal` network that only the API is attached to; the proxy holds the socket
read-only and refuses everything not explicitly enabled. Allowed: `PING`,
`VERSION`, `CONTAINERS`, `NETWORKS`, `POST`, `EXEC` — the exact set needed to
create, start, stop, inspect and exec into mules and attach them to the RPC
network. Refused (403): images, volumes, secrets, configs, swarm, nodes,
services, tasks, plugins, build, commit, and the system/info endpoints. Mules
sit on a different network and have no route to the proxy at all.

**This narrows the surface; it is not a trust boundary.** `CONTAINERS` plus
`POST` is inherently enough to create a container with an arbitrary bind mount
or `privileged: true` and reach host root, and Smuggler cannot manage mules
without them. So a remote-code-execution in the API or its dependencies is
still, in the worst case, host root — it just no longer gets the unrestricted
Docker API for free. The host remains a trusted, single-tenant component: keep
the API off the LAN, keep the token enabled, and keep dependencies patched.

A genuine boundary would need a purpose-built proxy that authorises each request
against the `smuggler.mule` label and rejects container-create payloads carrying
mounts, capabilities or `privileged`. That is tracked as future work, not
something the off-the-shelf proxy provides.

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

# 4. RPC ingress is restricted to the Docker gateway, not the whole bridge
docker exec <mule> iptables -S INPUT | grep 6800

# 5. DNS is locked and Docker's resolver is blocked
docker exec <mule> cat /etc/resolv.conf
docker exec <mule> iptables -S OUTPUT | grep 127.0.0.11

# 6. The control plane is not on the LAN (run from another host — must fail)
curl --max-time 3 http://<host-lan-ip>:55555/api/health/
```

**Fail-closed drill** — confirm a mule that cannot arm its kill-switch refuses to
run, rather than starting unprotected. Deploy a config whose `Endpoint` /
`remote` hostname does not resolve:

```bash
# The container must exit non-zero; aria2 must never have started.
docker logs <mule> | grep -E 'FATAL|kill-switch cannot be armed'
docker exec <mule> pgrep aria2c            # must find nothing (container is gone)
```

The deploy is expected to fail with a clear error. Before this was enforced, the
mule started with **no firewall at all** and only logged a warning.

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
