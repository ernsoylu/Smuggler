# Claude Custom Instructions for Smuggler (Mule VPN Downloader)

## Project Overview
You are assisting in building **Smuggler**, a containerized Torrent Downloader. The application isolates torrent downloads inside distinct Docker containers called **mules**. Each mule establishes its own WireGuard VPN connection before starting the torrent client (aria2).

## Technology Stack
- **Backend:** Python 3.12+, Flask, `uv`
- **Frontend:** TypeScript, React 18, Vite, TanStack Query, Tailwind CSS, Recharts
- **Containerization:** Docker, Docker SDK for Python
- **Networking:** WireGuard (raw `wg`/`ip` commands)
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

## Module Map

### `cli/`
| File | Purpose |
|---|---|
| `docker_client.py` | All Docker operations — `start_mule`, `stop_mule`, `kill_mule`, `list_mules`, `get_mule`, `wait_for_vpn`, `exec_in_mule` |
| `aria2_client.py` | aria2 JSON-RPC client — add, remove, pause, resume, stats, options |
| `mule_commands.py` | Click group `mule` — start/list/stop/kill/ip commands |
| `torrent_commands.py` | Click group `torrent` — add/list/remove/pause/resume commands |
| `main.py` | `smg` CLI entry point; registers `mule_group` and `torrent_group` |
| `log.py` | Shared logging setup (file + console, `.env`-controlled, `dvd.*` hierarchy) |

### `api/`
| File | Purpose |
|---|---|
| `app.py` | Flask app factory; registers all blueprints and calls `init_db()` |
| `mules.py` | Blueprint `/api/mules` — CRUD + VPN wait + IP lookup |
| `torrents.py` | Blueprint `/api/torrents` — list, add, remove, pause, resume |
| `stats.py` | Blueprint `/api/stats` — aggregated speed/count across all mules |
| `settings.py` | Blueprint `/api/settings` — get/set download settings backed by SQLite |
| `configs.py` | Blueprint `/api/configs` — upload/list/delete VPN configs; deploy as mule |
| `database.py` | SQLite layer — `settings` and `vpn_configs` tables, WAL mode |
| `settings_sync.py` | `sync_all_mules()` — pushes settings to running mules via aria2 options |
| `schemas.py` | Shared serialization helpers |
| `run.py` | Dev-server entry point |

### `web/src/`
| Path | Purpose |
|---|---|
| `pages/TorrentsPage.tsx` | Main dashboard — torrent list + global stats |
| `pages/MulesPage.tsx` | Mule management with deploy pipeline UI |
| `pages/ConfigsPage.tsx` | VPN config upload and one-click mule deployment |
| `pages/SettingsPage.tsx` | Settings form (download dir, speed limits, concurrency) |
| `components/MuleCard.tsx` | Per-mule card with status, IP, country, stop/kill actions |
| `components/TorrentRow.tsx` | Torrent table row with progress bar and actions |
| `components/StatsBar.tsx` | Global download/upload speed + active/queued/stopped counts |
| `components/SpeedGraph.tsx` | Recharts real-time speed graph |
| `components/AddTorrentModal.tsx` | Modal for adding magnet/file to a selected mule |
| `components/DeployMuleModal.tsx` | Modal for deploying a stored VPN config as a new mule |
| `api/client.ts` | Axios API client — all `getMules`, `addMagnet`, `deployMule`, etc. |
| `api/types.ts` | TypeScript interfaces — `Mule`, `Torrent`, `GlobalStats`, `VpnConfig`, etc. |

## Rules & Coding Standards
- **Naming:** Always use "mule" instead of "worker". The project is "Smuggler".
- **VPN First:** Never start aria2 without a verified WireGuard connection.
- **Labels:** Use `smuggler.*` namespace for Docker labels.
- **No Duplicate Logic:** API must call `cli/docker_client.py` and `cli/aria2_client.py`.
- **Private Key Safety:** Never expose `PrivateKey` in API responses or logs.
- **Strict Typing:** Use Python type hints and TypeScript interfaces.
- **Testing:** All branding changes must be reflected in the `tests/` suite.
- **Logging:** Use `cli/log.py` (`get_logger(__name__)`) in every module. Controlled by `DVD_LOGGING` and `DVD_LOG_LEVEL` in `.env`.
