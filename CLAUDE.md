# Smuggler: Project Knowledge

## Tech Stack
- **Backend:** Python 3.12+ (uv), Flask, Docker SDK, aria2-rpc.
- **Frontend:** React 18 (Vite), TS, Tailwind, TanStack Query, Recharts.
- **VPN:** WireGuard (raw wg/ip) & OpenVPN (tun0).
- **Storage:** SQLite (WAL), Migration-aware.

## Critical Architectural Rules
1. **VPN-First:** aria2 MUST NOT start until VPN (wg0/tun0) is up and IP verified.
2. **Naming:** Always use "mule", never "worker".
3. **Labels:** Use `smuggler.*` namespace for Docker labels.
4. **No Code Duplication:** API blueprints must call `cli/` clients (docker/aria2).
5. **Security:** Never log or expose PrivateKeys/Credentials. Use environment variables for mule credentials.
6. **Path Resolution:** Use `SMG_HOST_ROOT` for paths to be mounted into containers (data/tmp, downloads).

## Core Commands
- **Setup:** `./setup.sh`
- **Prod:** `./start.sh build | stop | prune`
- **Dev:** `./start.sh debug`
- **Test:** `uv run pytest tests/`
- **CLI:** `uv run smg`
- **Push:** Following the [Git & Quality Workflow](SKILLS.md#git--quality-workflow)

## Directory Structure
- `api/`: Flask blueprints, database, watchdog logic.
- `cli/`: Shared Docker/aria2 clients, CLI commands.
- `web/`: React frontend (Vite).
- `worker_image/`: WireGuard mule Dockerfile/startup.
- `worker_image_ovpn/`: OpenVPN mule Dockerfile/startup.
- `data/`: SQLite DB, temporary VPN configs (gitignored).
- `downloads/`: Shared download volume.

## Quality Standards
- **SonarQube:** Mandatory analysis before push (Project: `ernsoylu_Smuggler`). Fix all BLOCKERS.
- **Testing:** Maintain 100+ tests coverage. Branding changes must update `tests/`.
- **Typing:** Strict Python type hints and TypeScript interfaces.

---
**See [SKILLS.md](SKILLS.md) for procedural development guides.**
