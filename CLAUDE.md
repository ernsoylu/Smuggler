# Claude Custom Instructions for Torrent VPN Manager

## Project Overview
You are acting as a Senior Full-Stack and DevOps Engineer to assist in building a containerized Torrent Downloader. The application allows users to isolate torrent downloads inside distinct Docker containers (workers). Each worker establishes its own WireGuard VPN connection (using Mega VPN configurations) before starting the torrent client.

## Technology Stack
- **Backend:** Python 3.12+, Flask, Flask-CORS, `uv` (for dependency management)
- **Frontend:** TypeScript, React 18, Vite, TanStack Query, Tailwind CSS, Recharts
- **Containerization:** Docker, Docker SDK for Python
- **Networking:** WireGuard (configured via raw `wg`/`ip` commands — not `wg-quick`)
- **Torrent Client:** aria2 (JSON-RPC) — chosen over Deluge for simpler API and lighter container footprint
- **Version Control:** Git (`master` = stable, `phase-2` = current development)

## Development Phases

### Phase 1: CLI Implementation & Infrastructure — COMPLETE ✅
All 82 tests passing. Key implementation decisions:
- **aria2** used as the torrent client (not Deluge/transmission) — exposes a JSON-RPC API on port 6800.
- **Raw `wg` + `ip` commands** used instead of `wg-quick` to avoid `sysctl` permission errors inside containers.
- `wg-quick`-specific config fields (`Address`, `DNS`, `MTU`, etc.) are stripped before calling `wg setconf`.
- VPN endpoint is pinned to the Docker gateway to prevent routing loops.
- DNS is switched to the VPN nameserver only after external connectivity is confirmed.
- Containers run with `restart_policy=unless-stopped` for persistence.
- Worker metadata (RPC token, host port) is stored in Docker container labels.
- `dvd worker start` blocks until the VPN is confirmed; prints external IP and country on success.
- `dvd worker kill [--all]` provides SIGKILL semantics alongside the graceful `dvd worker stop`.

### Phase 2: Web Interface — IN PROGRESS 🔄
**Branch:** `phase-2`

#### Backend — Flask REST API (`api/` module)
- App factory in `api/app.py` with Flask-CORS enabled.
- Blueprints: `api/workers.py`, `api/torrents.py`, `api/stats.py`.
- Wraps existing `cli/docker_client.py` and `cli/aria2_client.py` — no duplicate logic.
- `POST /api/workers` accepts a multipart upload of the VPN config file and blocks until VPN is confirmed (same semantics as CLI).
- Private keys must never appear in API responses — strip `PrivateKey` from any config echoed back.

#### Frontend — React SPA (`web/` module)
- Vite + React 18 + TypeScript.
- TanStack Query for all data fetching with automatic polling.
- Tailwind CSS for styling.
- Recharts for the torrent speed graph.
- Two main pages: **Workers** and **Torrents**.
- Add Torrent modal: magnet link input OR `.torrent` file upload + worker selector dropdown.

## Rules & Coding Standards
- **Strict Typing:** Python type hints everywhere; strict TypeScript interfaces for all API shapes.
- **VPN First:** Never allow a torrent process to start inside a worker without a verified WireGuard connection. This is enforced both in the container startup script and in the CLI/API layer.
- **Shared Storage:** All downloaded files must map to the common `./downloads` volume on the host, mounted at `/downloads` inside every container.
- **No Duplicate Logic:** The Flask API must call the existing `cli/` modules directly — do not reimplement Docker or aria2 logic in the API layer.
- **Error Handling:** Propagate Docker socket errors and VPN timeouts as structured JSON error responses (`{ "error": "..." }`).
- **File Edits:** When generating code, output the full file paths and specify whether to create or overwrite.
- **Private Key Safety:** Never include WireGuard `PrivateKey` values in any API response, log output, or frontend display.
