# Smuggler — Dockerized VPN Downloader

**Smuggler** is a containerized torrent downloading stack that isolates downloads inside distinct Docker containers (**mules**). Each mule establishes its own VPN tunnel (WireGuard/OpenVPN) and arms a strict `iptables` kill-switch **before** the download client is allowed to start.

[Architecture Diagram placeholder]

## Core Features
- **Strict Isolation**: One VPN tunnel per mule. No traffic leaks if the VPN drops.
- **Dual Protocol**: Native support for WireGuard (`.conf`) and OpenVPN (`.ovpn`).
- **Web & CLI**: Manage everything via a modern React UI or a powerful Python CLI (`smg`).
- **Usable Torrent List**: Search, sortable columns, configurable page size, multi-select with bulk pause/resume/remove, per-torrent file selection, speed limits and first/last-piece priority, plus categories.
- **Drop to Add**: Drag a `.torrent` anywhere in the window; it is routed to the least-loaded mule automatically.
- **Real Deploy Progress**: Deployment is asynchronous and reports the phase the mule actually reports — not a timer animation.
- **Keyboard & Theme**: `Ctrl+K` command palette, `N` to add, `/` to search, and a light/dark/system theme.
- **Global Notifications**: Real-time deployment tracking, watchdog alerts, and system feedback via a centralized notification bell.
- **Host Watchdog**: Background health checks that automatically evacuate and kill compromised mules.
- **Systemwide Observer**: A read-only audit engine records every mule state transition, evacuation, and mutating API call to a persistent events table (`/api/events`), scans mule stdout for secret-shaped content, and turns any attempt to log a secret into a `secret_redacted` audit event — all log output passes through a redaction filter first.
- **Unified Storage**: All downloads land in a single host folder, regardless of which mule handled them.

## System Invariants
- **VPN-First**: Downloads never start without a verified external IP through the tunnel.
- **No-Leak Kill-Switch**: Each mule installs an `iptables` kill-switch permitting only VPN transport to the pinned endpoint and RPC replies on the real NIC — if the tunnel drops, traffic is dropped, not leaked. Health checks compare the tunnel exit IP against the default-route exit IP to catch mis-routing.
- **Auto-Recovery**: Mules use `unless-stopped` restarts; watchdog handles evacuation on persistent failure.
- **Private Key Safety**: Credentials and keys are never stored on disk inside the containers beyond the handshake phase, and VPN config bodies + OpenVPN passwords are encrypted at rest (Fernet with a **scrypt**-derived key from `SMG_SECRET_KEY` + `SMG_SECRET_SALT`). Storing a secret without a key is refused rather than silently written in plaintext.

## Security & Access
- **Loopback by default**: Compose publishes the API to `127.0.0.1:55555` and the UI to `127.0.0.1:8887`. Neither runs in the host's network namespace — they sit on Docker bridge networks, with aria2 RPC carried over an `internal` network that has no route off the host. The API can drive Docker through a filtered socket proxy (it no longer mounts the socket itself), so it must still not be exposed to the LAN; widen the published port only behind an authenticated reverse proxy.
- **API token (on by default)**: `setup.sh` generates `SMG_API_TOKEN` into `.env`, requiring an `X-Smuggler-Token` header on every `/api/*` call. The web UI injects it automatically; the `smg` CLI reads it from the environment. It is **mandatory** under Docker Compose, where mules share a network with the API.
- **CSRF-guarded**: State-changing requests carrying a browser `Origin` outside the allow-list are refused.
- **Unprivileged UI container**: The web container runs as uid 101 on `nginx-unprivileged`, so the container facing the browser holds no root.
- **Least privilege**: Mules start from `cap_drop: ALL` and add back only the five capabilities they need (no `CAP_SYS_MODULE`, no `NET_RAW`), run with `no-new-privileges` and memory/PID ceilings, and drop aria2 to your uid so downloads are not root-owned. `setup.sh` loads the `wireguard` module on the host instead.

## Quick Start (Docker Compose)
The fastest way to run Smuggler is via the included lifecycle script:

```bash
./start.sh build    # 1. Build worker images and start the API/UI stack
# Open http://localhost:8887
./start.sh stop     # 2. Stop the stack
./start.sh prune    # 3. Full cleanup (removes all volumes and lingering mules)
```

## Development
- **Local Debug**: `./start.sh debug` (Vite + Flask with hot-reload).
- **Setup**: `./setup.sh` (installs deps and builds all 4 images).
- **Tests**: `uv run pytest tests/` (458 passing tests, plus 139 frontend tests via `npm run test:run`).
  > If the backend suite fails en masse with `401`, your local `.env` has a real `SMG_API_TOKEN`;
  > it is loaded at import and the test client sends no header. Run `SMG_API_TOKEN= uv run pytest tests/`.
- **CI/CD**: Path-filtered GitHub Actions workflows (least-privilege permissions, concurrency-cancelled, dependency-cached):
  - **Python CI**: `ruff` lint + `pytest` matrix (3.12, 3.13, 3.14) with coverage.
  - **Frontend CI**: `tsc` type-check, ESLint, `vitest`, and production build.
  - **Docker CI**: `hadolint` + cached build of all 4 images + `docker compose config` validation.
  - **Shell CI**: `shellcheck` over the mule kill-switch / leak-protection scripts and setup scripts.
  - **Security CI**: `pip-audit` on the resolved Python lock file, `npm audit` (production advisories fail; build-tooling advisories are reported), Trivy CVE scans of all four images, Trivy IaC misconfiguration scanning, and a CycloneDX SBOM artifact. Also runs weekly on a schedule, because a dependency advisory can land without anyone touching the code.
  - **SonarQube Cloud**: analysis + quality gate (auto-skips until `SONAR_TOKEN` is set).

  Dependabot keeps Python, npm, GitHub Actions and the digest-pinned base images current — scanning reports a CVE, Dependabot is what closes it. All actions are SHA-pinned.

  A single `ci.yml` orchestrator detects which areas a change touches and invokes only those reusable workflows, ending in one always-running **CI Gate** job.

  > In branch protection, require just the **`CI / CI Gate`** status. It reports on every PR and fails if any triggered area failed (untouched areas count as passing), so path-filtered jobs never leave a required check stuck "pending". SonarQube runs as a separate, token-gated analysis.

---
**Technical documentation for AI/Developers:**
- [SECURITY.md](SECURITY.md) — Threat model, security controls, and leak-verification steps.
- [CLAUDE.md](CLAUDE.md) — Architectural rules and project context.
- [SKILLS.md](SKILLS.md) — Procedural development guides.
