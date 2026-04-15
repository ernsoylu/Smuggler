# Product Requirements Document (PRD) — Smuggler

## L1 Requirements (Business & System Level)
- **L1.1 Isolated Downloads:** The system shall isolate torrent downloading tasks into independent environments to prevent IP leakage and manage network routing securely.
- **L1.2 Multi-VPN Support:** The system shall allow simultaneous connections to different VPN servers by using distinct mule containers.
- **L1.3 Centralized Management:** The system shall provide a unified interface (CLI and Web UI) to manage all mules and downloads seamlessly.

## L2 Requirements (User Level)
- **L2.1 Mule Management:**
  - Users can create a new mule and supply a WireGuard configuration file.
  - Mule creation blocks until the VPN connection is verified — users see the confirmed external IP and country before the command returns.
  - Mules persist across restarts (`unless-stopped` policy); they only stop when explicitly killed.
  - Users can view a list of active mules, including their current external IP address and geographical country.
  - Users can gracefully stop (SIGTERM) or force-kill (SIGKILL) individual mules.
  - Users can force-kill all mules at once with a single command.
- **L2.2 Torrent Management:**
  - Users can add torrents using a magnet link or uploading a `.torrent` file.
  - When adding a torrent, the user must be able to select which active mule will handle the download.
  - Users can pause and resume individual torrents.
  - Users can view a dashboard showing:
    - Overall global download/upload speed.
    - Individual torrent progress bars.
    - A detailed property view for a selected torrent (peers, trackers, files, speed graphs).
- **L2.3 File Access:** Users shall be able to access all completed downloads from a single, centralized `downloads` folder on the host machine.
- **L2.4 VPN Config Management:** Users can upload, store, and deploy WireGuard configuration files from the Web UI without touching the filesystem directly.
- **L2.5 Settings:** Users can configure global download settings (download directory, speed limits, concurrency) via the Web UI. Settings are persisted and automatically applied to all running mules.

## L3 Requirements (Functional Level)

### L3.1 Phase 1 (CLI) — COMPLETE ✅
- CLI tool (`smg`) built with Click, using the Docker SDK to manage container lifecycles.
- Torrent client: **aria2** (JSON-RPC).
- Commands implemented:
  - `smg build` — build the mule Docker image.
  - `smg mule start --config FILE` — start container, block until VPN confirmed.
  - `smg mule list` — show all mules and status.
  - `smg mule stop NAME [--keep]` — graceful stop (SIGTERM).
  - `smg mule kill NAME|--all [--keep] [--yes]` — force kill (SIGKILL).
  - `smg mule ip NAME` — show external IP and geolocation.
  - `smg torrent add MULE --magnet URI | --file FILE` — add torrent.
  - `smg torrent list [MULE]` — list torrents with progress.
  - `smg torrent remove/pause/resume MULE GID` — torrent lifecycle.
- Comprehensive unit and integration test suite (108 tests).

### L3.2 VPN Enforcement
- Mule container sets up WireGuard using raw `wg` + `ip` commands to avoid `sysctl` permission issues in rootless containers.
- The VPN endpoint is pinned to the Docker gateway before the default route is replaced.
- DNS is switched to the VPN nameserver only after external connectivity is confirmed.
- Kill-switch: a watchdog process inside the container kills aria2 with SIGKILL if `wg0` disappears.
- `wait_for_vpn` additionally polls aria2 JSON-RPC until it accepts connections before returning, eliminating connection errors during startup.

### L3.3 Docker Integration
- Host directory `./downloads` is mounted to `/downloads` inside every mule container.
- Mule metadata (RPC token, host port, VPN config name) is stored in Docker container labels under the `smuggler.*` namespace.
- Containers run with `restart_policy=unless-stopped` for persistence.
- Required capabilities: `NET_ADMIN`, `SYS_MODULE`.

### L3.4 Phase 2 (API & Web) — COMPLETE ✅

#### Flask REST API (`api/`)
| Endpoint | Method | Description |
|---|---|---|
| `/api/mules/` | GET | List all mules with status and IP info |
| `/api/mules/` | POST | Create mule from uploaded VPN config; blocks until VPN confirmed |
| `/api/mules/<name>` | GET | Get a single mule |
| `/api/mules/<name>` | DELETE | Stop and remove a mule (`?keep=true` to preserve container) |
| `/api/mules/<name>/kill` | POST | Force-kill a mule |
| `/api/mules/<name>/ip` | GET | Get mule's current external IP info |
| `/api/torrents/` | GET | List all torrents across all mules |
| `/api/torrents/<mule>` | GET | List torrents for a specific mule |
| `/api/torrents/<mule>` | POST | Add magnet or `.torrent` file to a mule |
| `/api/torrents/<mule>/<gid>` | DELETE | Remove a torrent |
| `/api/torrents/<mule>/<gid>/pause` | POST | Pause a torrent |
| `/api/torrents/<mule>/<gid>/resume` | POST | Resume a paused torrent |
| `/api/stats/` | GET | Aggregated global speed, active/waiting/stopped counts, mule count |
| `/api/settings/` | GET/POST | Read and update global settings (SQLite-backed) |
| `/api/configs/` | GET | List stored VPN configs |
| `/api/configs/` | POST | Upload a new VPN config |
| `/api/configs/<id>` | DELETE | Delete a stored VPN config |
| `/api/configs/<id>/deploy` | POST | Deploy a stored config as a new mule |

#### React Web UI (`web/`)
- **Torrents page** — live-polling torrent dashboard with StatsBar and per-torrent rows.
- **Mules page** — mule list with start/stop/kill actions and per-mule IP + country display.
- **Configs page** — upload WireGuard configs and deploy them as mules with stage progress.
- **Settings page** — edit download directory, max concurrent downloads, and speed limits.

#### SQLite Storage (`api/database.py`)
- `settings` table — key/value pairs with defaults: `download_dir`, `max_concurrent_downloads`, `max_download_speed`, `max_upload_speed`.
- `vpn_configs` table — stores uploaded config files as BLOBs with metadata.
- WAL mode enabled for safe concurrent access.

#### Settings Sync (`api/settings_sync.py`)
- `apply_settings_to_mule(mule_name, settings)` — pushes current settings to a specific mule via `aria2.change_global_option`.
- `sync_all_mules()` — iterates all running mules and applies current settings.

#### Logging (`cli/log.py`)
- Controlled by `.env` variables: `DVD_LOGGING=true/false`, `DVD_LOG_LEVEL=DEBUG|INFO|WARNING|ERROR`.
- Writes dated log files to `logs/dvd_YYYY-MM-DD_HH-MM-SS.log`.
- Console handler at WARNING+; file handler at configured level.
- All modules use `get_logger(__name__)` for structured `dvd.*` hierarchy.

## L4 Requirements (Non-Functional / Technical)
- **L4.1 Tech Stack:**
  - Python 3.12+ managed with `uv`.
  - Backend framework: Flask 3.x.
  - Frontend: React 18 + TypeScript + Vite + TanStack Query + Tailwind CSS + Recharts.
  - Database: SQLite with WAL mode.
- **L4.2 Security & Privacy:**
  - `vpn_configs/*.conf` is gitignored.
  - Kill-switch: if `wg0` drops, aria2 is killed with SIGKILL immediately.
  - WireGuard private keys are never exposed through the API or logs.
- **L4.3 Testing:**
  - 108 tests covering CLI commands, Docker client, aria2 client, and all API endpoints.
  - Tests use mocked Docker and aria2 (via `responses` library) — no real Docker or `.conf` files required.
- **L4.4 CI/CD:**
  - GitHub Actions runs on every push and pull request to `main`.
  - `python-ci.yml` — matrix over Python 3.12 and 3.13 using `uv`; coverage report on 3.12.
  - `frontend-ci.yml` — triggers only on changes under `web/`; runs `tsc --noEmit` then `vite build`.
