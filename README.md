# Smuggler — Dockerized VPN Downloader

**Smuggler** is a containerized torrent downloading stack that isolates downloads inside distinct Docker containers (**mules**). Each mule establishes its own VPN tunnel (WireGuard/OpenVPN) and implements a strict hardware-level kill-switch before starting the download client.

[Architecture Diagram placeholder]

## Core Features
- **Strict Isolation**: One VPN tunnel per mule. No traffic leaks if the VPN drops.
- **Dual Protocol**: Native support for WireGuard (`.conf`) and OpenVPN (`.ovpn`).
- **Web & CLI**: Manage everything via a modern React UI or a powerful Python CLI (`smg`).
- **Host Watchdog**: Background health checks that automatically evacuate and kill compromised mules.
- **Unified Storage**: All downloads land in a single host folder, regardless of which mule handled them.

## System Invariants
- **VPN-First**: Downloads never start without a verified external IP through the tunnel.
- **Auto-Recovery**: Mules use `unless-stopped` restarts; watchdog handles evacuation on persistent failure.
- **Private Key Safety**: Credentials and keys are never stored on disk inside the containers beyond the handshake phase.

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
- **Tests**: `uv run pytest tests/` (100+ fully-mocked tests).

---
**Technical documentation for AI/Developers:**
- [CLAUDE.md](CLAUDE.md) — Architectural rules and project context.
- [SKILLS.md](SKILLS.md) — Procedural development guides.
