# Claude Custom Instructions for Smuggler (Mule VPN Downloader)

## Project Overview
You are assisting in building **Smuggler**, a containerized Torrent Downloader. The application isolates torrent downloads inside distinct Docker containers called **mules**. Each mule establishes its own VPN connection (WireGuard or OpenVPN) before starting the torrent client (aria2).

## Technology Stack
- **Backend:** Python 3.12+, Flask, `uv`
- **Frontend:** TypeScript, React 18, Vite, TanStack Query, Tailwind CSS, Recharts
- **Containerization:** Docker, Docker SDK for Python
- **Networking:** WireGuard (raw `wg`/`ip` commands) **and** OpenVPN (`openvpn` process with `tun0`)
- **Torrent Client:** aria2 (JSON-RPC)
- **CLI Tool:** `smg` (Click-based)
- **Database:** SQLite (WAL mode, via `sqlite3`) for settings and VPN config storage

## Development Status

### Phase 1: Infrastructure & CLI — COMPLETE ✅
- **Mule containers** use raw `wg` + `ip` for VPN isolation.
- **aria2** is the download engine.
- **Kill-switch** watchdog inside containers ensures no traffic leaks if the VPN drops.
- **CLI (`smg`)** provides commands for building, starting/stopping mules, and managing torrents.
- **Labels** (`smuggler.mule`, `smuggler.rpc_token`) are used for container discovery.

### Phase 2: Web Interface & API — COMPLETE ✅
- **Flask API (`api/`)**:
  - Blueprints: `mules_bp`, `torrents_bp`, `stats_bp`, `settings_bp`, `configs_bp`.
  - Endpoint prefix: `/api/mules`, `/api/torrents`, `/api/stats`, `/api/settings`, `/api/configs`.
  - SQLite-backed settings and VPN config storage (`api/database.py`).
  - `api/settings_sync.py` propagates settings to all running mules via aria2 JSON-RPC.
- **React UI (`web/`)**:
  - **TorrentsPage** — global torrent dashboard with live speed stats (StatsBar, TorrentRow).
  - **MulesPage** — per-mule management (start, stop, kill, IP display with country).
  - **ConfigsPage** — upload, list, and deploy VPN configs as new mules.
  - **SettingsPage** — manage download directory and bandwidth limits.
  - Shared components: `MuleCard`, `AddTorrentModal`, `DeployMuleModal`, `SpeedGraph`, `StatsBar`.
- **108 tests passing** across all modules.

### Phase 3: OpenVPN Support & UI Polish — COMPLETE ✅
- **Dual VPN type:** Each mule can run either WireGuard (`.conf`) or OpenVPN (`.ovpn`).
  - WireGuard image: `smuggler-mule:latest` (`worker_image/`), uses `wg`/`ip`, `NET_ADMIN+SYS_MODULE`.
  - OpenVPN image: `smuggler-mule-ovpn:latest` (`worker_image_ovpn/`), uses `openvpn` + `tun0`, `NET_ADMIN` only, `/dev/net/tun` device passthrough.
  - VPN type auto-detected from file extension (`.ovpn` → openvpn, `.conf` → wireguard).
- **OpenVPN startup hardening** (`worker_image_ovpn/startup.sh`):
  - Writes credentials to a `chmod 600` temp file, removed immediately after `tun0` is up.
  - Pins the VPN server endpoint to the original gateway before OpenVPN rewrites routes.
  - Policy routing keeps eth0 reply traffic on the original gateway.
  - Kill-switch watchdog kills aria2 if `tun0` disappears.
- **CLI updates:** `smg mule start` gains `--vpn-type`, `--username`, `--password`; `smg build` gains `--vpn-type wireguard|openvpn`.
- **API updates:** `vpn_configs` table gains `vpn_type`, `requires_auth`, `ovpn_username`, `ovpn_password`; SQLite migration applied at startup.
- **ConfigsPage:** Configs categorised by type (WireGuard / OpenVPN). Upload form shows credential fields (with show/hide toggle) when `auth-user-pass` is detected in the `.ovpn` file.
- **Setup & start scripts:** `setup.sh` installs all dependencies + builds both Docker images idempotently. `start.sh` runs 7 pre-flight checks and directs users to `setup.sh` if anything is missing.
- **TorrentsPage:** Fixed table header misalignment (invalid `<div>` in `<tr>`). Added bottom analytics section: transfer summary (downloaded/uploaded/ratio) and a Recharts donut chart showing torrent status distribution.

### Phase 4: Compose Stack & Watchdog Hardening — COMPLETE ✅
- **Docker Compose stack** (`docker-compose.yml`, `docker/`): The app now ships as two service containers — `smuggler-api` (gunicorn `--timeout 180 --threads 8`, host network, Docker socket mounted in) and `smuggler-ui` (nginx serving the Vite build and reverse-proxying `/api/*` to the API over the host gateway). `start.sh` was rewritten as a lifecycle wrapper: `build | debug | stop | prune`.
- **`SMG_HOST_ROOT` env var** — the API container uses it to resolve paths (`data/smuggler.db`, `data/tmp/<vpn-config>`, default downloads dir) to host-visible paths so Docker can mount them into spawned mule containers.
- **Deploy reliability** — nginx `proxy_*_timeout` and gunicorn `--timeout` both set to 180s so `POST /api/configs/<id>/deploy` no longer returns a network error mid-VPN-handshake (the deploy's `wait_for_vpn` can take up to 90s).
- **Host watchdog** (`api/watchdog.py`): background daemon, interval 15s, evacuates mules that fail 3 consecutive health checks. State is per-mule (`consecutive_failures`, `evacuated`) and cleaned up when a mule disappears from `list_mules`. Evacuation migrates active/waiting torrents to a healthy target mule before killing the compromised one.
- **VPN health probe resilience** (`cli/docker_client.py`): `check_mule_vpn` now probes `icanhazip.com` first and falls back to `ipinfo.io`, matching the in-container startup scripts. This fixes false-positive evacuations when `ipinfo.io` returns HTTP 429 and curl exits 22.
- **Torrent file deletion**: `DELETE /api/torrents/<mule>/<gid>?delete_files=true` unlinks the files from the shared downloads volume and prunes empty parents inside the download dir. aria2 client gains `remove_download_result` so completed/error torrents can be cleared. Frontend `DeleteTorrentModal` offers a keep-files vs. delete-files choice; `TorrentRow` splits start/stop disabled states per aria2 status.
- **Settings safety**: `POST /api/settings/` validates the download directory is an absolute non-traversal path, creates it if missing, and rejects the change with 403 if the directory is not writable. Same check runs at app startup as a log warning.
- **UI polish**: `StatusFooter` adds an expandable panel (bandwidth history + transfer summary + status distribution). `TorrentRow` peers tab renders country flag emojis via GeoJS (with a local-IP shortcut). `data/` is git-ignored (SQLite DB + tmp VPN uploads with private keys).

## Module Map

### `cli/`
| File | Purpose |
|---|---|
| `docker_client.py` | All Docker operations — `start_mule`, `stop_mule`, `kill_mule`, `list_mules`, `get_mule`, `wait_for_vpn`, `exec_in_mule`, `check_mule_vpn` (two-probe: icanhazip + ipinfo fallback), `evacuate_mule` |
| `aria2_client.py` | aria2 JSON-RPC client — add, remove, `remove_download_result`, pause, resume, stats, options, peers, file selection |
| `mule_commands.py` | Click group `mule` — start/list/stop/kill/ip commands |
| `torrent_commands.py` | Click group `torrent` — add/list/remove/pause/resume commands |
| `main.py` | `smg` CLI entry point; registers `mule_group` and `torrent_group` |
| `log.py` | Shared logging setup (file + console, `.env`-controlled, `dvd.*` hierarchy) |

### `api/`
| File | Purpose |
|---|---|
| `app.py` | Flask app factory; registers all blueprints, calls `init_db()`, verifies `download_dir` writability |
| `mules.py` | Blueprint `/api/mules` — CRUD + VPN wait + IP lookup + health + evacuation |
| `torrents.py` | Blueprint `/api/torrents` — list, add, remove (optionally unlinks files from disk), pause, resume, peers, options, file selection |
| `stats.py` | Blueprint `/api/stats` — aggregated speed/count across all mules |
| `settings.py` | Blueprint `/api/settings` — get/set download settings backed by SQLite; validates absolute path, creates dir, rejects non-writable |
| `configs.py` | Blueprint `/api/configs` — upload/list/delete VPN configs; deploy as mule (writes temp config under `${SMG_HOST_ROOT}/data/tmp`) |
| `watchdog.py` | Blueprint `/api/watchdog` + daemon thread; 15s sweep, 3-strike evacuation, state cleanup when containers disappear |
| `database.py` | SQLite layer — `settings` and `vpn_configs` tables, WAL mode, DB path resolved via `SMG_DB_PATH` (defaults under `SMG_HOST_ROOT/data`) |
| `settings_sync.py` | `sync_all_mules()` — pushes settings to running mules via aria2 options |
| `schemas.py` | Shared serialization helpers |
| `run.py` | Legacy Flask dev-server entry point (prefer `main.py` under gunicorn) |

### `web/src/`
| Path | Purpose |
|---|---|
| `pages/TorrentsPage.tsx` | Main dashboard — torrent list; bottom analytics moved into `StatusFooter` expandable panel |
| `pages/MulesPage.tsx` | Mule management with deploy pipeline UI + watchdog panel (evacuate button) |
| `pages/ConfigsPage.tsx` | VPN config upload (WireGuard/OpenVPN) with credential fields; categorised list |
| `pages/SettingsPage.tsx` | Settings form (download dir, speed limits, concurrency) |
| `components/MuleCard.tsx` | Per-mule card with status, IP, country, stop/kill actions |
| `components/TorrentRow.tsx` | Torrent row — progress, actions, expandable info/files/peers tabs; peers show country flags |
| `components/StatsBar.tsx` | Global download/upload speed + active/queued/stopped counts |
| `components/StatusFooter.tsx` | Persistent footer: live speeds + expandable bandwidth history, transfer summary, status distribution |
| `components/SpeedGraph.tsx` | Recharts real-time speed graph |
| `components/AddTorrentModal.tsx` | Modal for adding magnet/file to a selected mule |
| `components/DeployMuleModal.tsx` | Modal for deploying a stored VPN config as a new mule |
| `components/DeleteTorrentModal.tsx` | Confirmation modal with keep-files vs. delete-files choice |
| `api/client.ts` | Axios API client — all `getMules`, `addMagnet`, `deployMule`, `removeTorrent` (with `deleteFiles` flag), `getWatchdogStatus`, etc. |
| `api/types.ts` | TypeScript interfaces — `Mule`, `Torrent`, `GlobalStats`, `VpnConfig`, `MuleHealth`, `WatchdogStatus`, `Peer`, etc. |

### Service containers (Docker Compose)
| Container | Context | Role |
|---|---|---|
| `smuggler-api` | `docker/Dockerfile.api` | Python 3.11 + gunicorn (`--timeout 180 --threads 8`), host network, Docker socket mounted |
| `smuggler-ui` | `docker/Dockerfile.web` | Vite build served by nginx; reverse-proxies `/api/*` to the API with 180s timeouts |

### Mule images
| Image | Context | VPN type | Capabilities |
|---|---|---|---|
| `smuggler-mule:latest` | `worker_image/` | WireGuard | `NET_ADMIN`, `SYS_MODULE` |
| `smuggler-mule-ovpn:latest` | `worker_image_ovpn/` | OpenVPN | `NET_ADMIN`, `/dev/net/tun` device |

## CI

| Workflow | File | Trigger |
|---|---|---|
| Python CI | `.github/workflows/python-ci.yml` | Push/PR to `main` — matrix Python 3.12 + 3.13, `uv`, coverage |
| Frontend CI | `.github/workflows/frontend-ci.yml` | Push/PR to `main` with `web/` changes — `tsc --noEmit` + `vite build` |

All tests run without real Docker or WireGuard configs. Use `DVD_LOGGING=false` to suppress log files in test runs.

## SonarQube Integration

Project key: `ernsoylu_Smuggler` (see `sonar-project.properties`). Organization: `ernsoylu`. Host: `https://sonarcloud.io`.

### Pre-push code analysis (mandatory)
Before every `git push`, run a SonarQube analysis on all modified files and resolve blocking findings:

1. **Resolve project key** — always use `ernsoylu_Smuggler`; read `sonar-project.properties` to confirm.
2. **Analyze changed files** — use `mcp__sonarqube__analyze_code_snippet` on any file modified in the current branch/commit set.
3. **Check quality gate** — call `mcp__sonarqube__get_project_quality_gate_status` and confirm status is `OK` before pushing.
4. **Fix blocking issues** — use `mcp__sonarqube__search_sonar_issues_in_projects` filtered to `severities=BLOCKER,CRITICAL`. Fix all BLOCKER issues; evaluate and fix CRITICAL issues unless there is a documented reason to accept them.
5. **Security hotspots** — call `mcp__sonarqube__search_security_hotspots` and review any `TO_REVIEW` hotspots before pushing.
6. **Do not push** if the quality gate is `ERROR` or there are unresolved BLOCKER issues.

### Ongoing analysis rules
- After editing any Python file run `mcp__sonarqube__analyze_code_snippet` on the changed snippet before writing the final version.
- After editing any TypeScript/TSX file do the same.
- Use `mcp__sonarqube__get_component_measures` to track coverage, duplication, and complexity trends; flag regressions to the user.
- Use `mcp__sonarqube__get_duplications` when adding new helpers or utilities to avoid introducing duplicate blocks.
- Use `mcp__sonarqube__show_rule` to explain any unfamiliar rule before suppressing or accepting it.

## Rules & Coding Standards
- **Naming:** Always use "mule" instead of "worker". The project is "Smuggler".
- **VPN First:** Never start aria2 without a verified VPN connection (WireGuard `wg0` or OpenVPN `tun0`).
- **Labels:** Use `smuggler.*` namespace for Docker labels.
- **No Duplicate Logic:** API must call `cli/docker_client.py` and `cli/aria2_client.py`.
- **Private Key Safety:** Never expose `PrivateKey` in API responses or logs.
- **Strict Typing:** Use Python type hints and TypeScript interfaces.
- **Testing:** All branding changes must be reflected in the `tests/` suite.
- **Logging:** Use `cli/log.py` (`get_logger(__name__)`) in every module. Controlled by `DVD_LOGGING` and `DVD_LOG_LEVEL` in `.env`.
