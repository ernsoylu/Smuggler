# Product Requirements Document (PRD)

## L1 Requirements (Business & System Level)
- **L1.1 Isolated Downloads:** The system shall isolate torrent downloading tasks into independent environments to prevent IP leakage and manage network routing securely.
- **L1.2 Multi-VPN Support:** The system shall allow simultaneous connections to different VPN servers by using distinct worker containers.
- **L1.3 Centralized Management:** The system shall provide a unified interface (CLI initially, Web UI eventually) to manage all workers and downloads seamlessly.

## L2 Requirements (User Level)
- **L2.1 Worker Management:**
  - Users can create a new worker and supply a Mega VPN WireGuard configuration file.
  - Worker creation blocks until the VPN connection is verified — users see the confirmed external IP and country before the command returns.
  - Workers persist across restarts (`unless-stopped` policy); they only stop when explicitly killed.
  - Users can view a list of active workers, including their current external IP address and geographical country.
  - Users can gracefully stop (SIGTERM) or force-kill (SIGKILL) individual workers.
  - Users can force-kill all workers at once with a single command.
- **L2.2 Torrent Management:**
  - Users can add torrents using a magnet link or uploading a `.torrent` file.
  - When adding a torrent, the user must be able to select which active worker will handle the download.
  - Users can pause and resume individual torrents.
  - Users can view a "Deluge-like" dashboard showing:
    - Overall global download/upload speed.
    - Individual torrent progress bars.
    - A detailed property page for a selected torrent (peers, trackers, files, speed graphs).
- **L2.3 File Access:** Users shall be able to access all completed downloads from a single, centralized `downloads` folder on the host machine.

## L3 Requirements (Functional Level)
- **L3.1 Phase 1 (CLI) — COMPLETE:**
  - CLI tool (`dvd`) built with Click, using the Docker SDK to manage container lifecycles.
  - Torrent client: **aria2** (JSON-RPC), chosen over Deluge for simpler API and lighter footprint.
  - Commands implemented:
    - `dvd build` — build the worker Docker image.
    - `dvd worker start --config FILE` — start container, block until VPN confirmed.
    - `dvd worker list` — show all workers and status.
    - `dvd worker stop NAME [--keep]` — graceful stop (SIGTERM).
    - `dvd worker kill NAME|--all [--keep] [--yes]` — force kill (SIGKILL).
    - `dvd worker ip NAME` — show external IP and geolocation.
    - `dvd torrent add WORKER --magnet URI | --file FILE` — add torrent.
    - `dvd torrent list [WORKER]` — list torrents with progress.
    - `dvd torrent remove/pause/resume WORKER GID` — torrent lifecycle.
  - 82 unit tests, all passing.

- **L3.2 VPN Enforcement:**
  - Worker container sets up WireGuard using raw `wg` + `ip` commands (not `wg-quick`) to avoid `sysctl` permission issues in rootless containers.
  - `wg-quick`-specific fields (`Address`, `DNS`, `MTU`, etc.) are stripped from the config before calling `wg setconf`.
  - The VPN endpoint is pinned to the Docker gateway before the default route is replaced, preventing WireGuard's own UDP traffic from looping through the tunnel.
  - DNS is switched to the VPN nameserver only after external connectivity is confirmed.
  - Kill-switch: a watchdog process inside the container kills aria2 with SIGKILL if `wg0` disappears.

- **L3.3 Docker Integration:**
  - Host directory `./downloads` is mounted to `/downloads` inside every worker container.
  - The Python backend uses the `docker` PyPI package for all container lifecycle management.
  - Worker metadata (RPC token, host port, VPN config name) is stored in Docker container labels.
  - Containers run with `restart_policy=unless-stopped` for persistence.
  - Required capabilities: `NET_ADMIN`, `SYS_MODULE`; sysctl: `net.ipv4.conf.all.src_valid_mark=1`.

- **L3.4 Phase 2 (API & Web) — NEXT:**
  - **Flask API** — REST endpoints wrapping the existing CLI core logic:

    | Endpoint | Method | Description |
    |---|---|---|
    | `/api/workers` | GET | List all workers |
    | `/api/workers` | POST | Start a new worker (multipart: vpn_config file + optional name) |
    | `/api/workers/<name>` | GET | Get single worker info |
    | `/api/workers/<name>` | DELETE | Stop and remove a worker |
    | `/api/workers/<name>/kill` | POST | Force-kill a worker |
    | `/api/workers/<name>/ip` | GET | Get current VPN IP and geolocation |
    | `/api/torrents` | GET | List all torrents across all workers |
    | `/api/torrents/<worker>` | GET | List torrents for a specific worker |
    | `/api/torrents/<worker>` | POST | Add torrent (JSON: magnet, or multipart: .torrent file) |
    | `/api/torrents/<worker>/<gid>` | DELETE | Remove a torrent |
    | `/api/torrents/<worker>/<gid>/pause` | POST | Pause a torrent |
    | `/api/torrents/<worker>/<gid>/resume` | POST | Resume a torrent |
    | `/api/stats` | GET | Global download/upload speed totals |

  - **React UI** — Single-page application:
    - **Worker Management Page:** Create worker (VPN config upload + optional name), workers table (name, status, IP, country, port), per-row Kill/Stop actions.
    - **Torrent Management Page:** Global stats bar (total speed), torrent list with progress bars, Add Torrent modal (magnet or file upload, worker selector dropdown), detail panel (peers, trackers, files, speed graph).
    - Real-time updates via **polling** (workers: 5 s, torrents: 2 s, stats: 2 s).

## L4 Requirements (Non-Functional / Technical)
- **L4.1 Tech Stack:**
  - Python 3.12+ managed with `uv`.
  - Backend framework: Flask with Flask-CORS.
  - Frontend: React 18 + TypeScript, Vite, TanStack Query, Tailwind CSS, Recharts.
- **L4.2 Security & Privacy:**
  - `vpn_configs/*.conf` is gitignored — private keys are never committed.
  - Kill-switch: if `wg0` drops, aria2 is killed with SIGKILL before any traffic can fall back to the host IP.
  - WireGuard private keys are never exposed through any API response.
- **L4.3 Version Control:** Git repository; Phase 2 developed on the `phase-2` branch.
- **L4.4 Testing:** All 82 Phase 1 unit tests pass. Phase 2 API endpoints must have integration tests before merge to master.
