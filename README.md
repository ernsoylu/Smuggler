# Smuggler — Dockerized VPN Downloader

Isolated torrent downloads inside per-mule Docker containers, each behind its own WireGuard VPN tunnel. No torrent process ever starts without a verified VPN connection.

## How it works

1. You supply a WireGuard `.conf` file and start a mule (CLI or Web UI).
2. The mule container sets up `wg0` using raw `wg`/`ip` commands (no `wg-quick`), verifies the external IP through the tunnel, then starts the aria2 daemon.
3. `smg mule start` blocks until both VPN and aria2 are confirmed ready — it only returns once it has the mule's real external IP and country.
4. Mules restart automatically (`unless-stopped`) if the container crashes.
5. A kill-switch watchdog inside the container kills aria2 immediately if `wg0` disappears.
6. You add torrents to the mule via the CLI or Web UI. All downloads land in the shared `./downloads` folder on the host.

## Requirements

- Docker
- Python 3.12+
- [uv](https://github.com/astral-sh/uv)
- Node.js 18+ (for the Web UI)
- A WireGuard `.conf` file

## Installation

```bash
git clone <repo>
cd Smuggler
uv sync
```

This installs the `smg` CLI into the project's virtual environment.

## Quick start

```bash
# 1. Build the mule Docker image (one-time)
smg build

# 2. Start a mule — blocks until VPN is confirmed
smg mule start --config vpn_configs/my-vpn.conf

# 3. Add a torrent
smg torrent add smuggler-mule-<name> --magnet "magnet:?xt=urn:btih:..."

# 4. Monitor progress
smg torrent list
```

Downloaded files appear in `./downloads/` on your host machine.

## Web UI

Start the API and frontend together:

```bash
./start.sh
```

Or separately:

```bash
# API (port 5000)
uv run python -m api.run

# Frontend (port 5173)
cd web && npm install && npm run dev
```

Open `http://localhost:5173` in your browser.

### Web UI pages

| Page | Description |
|---|---|
| **Torrents** | Live dashboard — global speed stats, per-torrent progress, add/pause/remove |
| **Mules** | Manage mule containers — start from uploaded config, stop, kill, view external IP |
| **Configs** | Upload WireGuard configs and deploy them as new mules in one click |
| **Settings** | Configure download directory, max concurrent downloads, and speed limits |

## CLI reference

### `smg build`

Builds the `smuggler-mule:latest` Docker image.

```
smg build [--context PATH] [--tag TAG]
```

### `smg mule`

| Command | Description |
|---|---|
| `smg mule start --config FILE` | Start a mule — blocks until VPN and aria2 are confirmed |
| `smg mule start --config FILE --name NAME` | Start a mule with a custom name |
| `smg mule list` | List all mules and their status |
| `smg mule stop NAME` | Gracefully stop and remove a mule |
| `smg mule stop --keep NAME` | Stop but keep the container |
| `smg mule ip NAME` | Show the mule's current external IP and geolocation |
| `smg mule kill NAME` | Force-kill a mule immediately |
| `smg mule kill --all` | Force-kill every mule (prompts for confirmation) |
| `smg mule kill --all --yes` | Force-kill every mule without prompt |

### `smg torrent`

| Command | Description |
|---|---|
| `smg torrent add MULE --magnet URI` | Add a magnet link to a mule |
| `smg torrent add MULE --file FILE` | Add a `.torrent` file to a mule |
| `smg torrent list` | List torrents across all running mules |
| `smg torrent list MULE` | List torrents for a specific mule |
| `smg torrent remove MULE GID` | Remove a torrent by GID |
| `smg torrent pause MULE GID` | Pause a torrent |
| `smg torrent resume MULE GID` | Resume a paused torrent |

## REST API

The Flask API runs on `http://localhost:5000`. All endpoints are prefixed with `/api`.

### Mules

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/mules/` | List all mules |
| `POST` | `/api/mules/` | Create mule from uploaded VPN config |
| `GET` | `/api/mules/<name>` | Get a single mule |
| `DELETE` | `/api/mules/<name>` | Stop and remove a mule |
| `POST` | `/api/mules/<name>/kill` | Force-kill a mule |
| `GET` | `/api/mules/<name>/ip` | Get mule's current external IP |

### Torrents

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/torrents/` | List all torrents (all mules) |
| `GET` | `/api/torrents/<mule>` | List torrents for one mule |
| `POST` | `/api/torrents/<mule>` | Add magnet or `.torrent` file |
| `DELETE` | `/api/torrents/<mule>/<gid>` | Remove a torrent |
| `POST` | `/api/torrents/<mule>/<gid>/pause` | Pause a torrent |
| `POST` | `/api/torrents/<mule>/<gid>/resume` | Resume a torrent |

### Stats / Settings / Configs

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/stats/` | Global speed, counts, and mule total |
| `GET/POST` | `/api/settings/` | Read and update download settings |
| `GET` | `/api/configs/` | List stored VPN configs |
| `POST` | `/api/configs/` | Upload a new VPN config |
| `DELETE` | `/api/configs/<id>` | Delete a stored VPN config |
| `POST` | `/api/configs/<id>/deploy` | Deploy a config as a new mule |

## Project layout

```
Smuggler/
├── worker_image/        # Docker context for mule containers
│   ├── Dockerfile
│   ├── entrypoint.sh    # WireGuard setup + aria2 start
│   └── watchdog.sh      # Kill-switch watchdog
├── api/                 # Flask REST API
│   ├── app.py           # App factory
│   ├── mules.py         # /api/mules blueprint
│   ├── torrents.py      # /api/torrents blueprint
│   ├── stats.py         # /api/stats blueprint
│   ├── settings.py      # /api/settings blueprint
│   ├── configs.py       # /api/configs blueprint
│   ├── database.py      # SQLite layer
│   └── settings_sync.py # Propagate settings to running mules
├── cli/                 # Python CLI (smg)
│   ├── main.py          # Entry point
│   ├── mule_commands.py # smg mule subcommands
│   ├── torrent_commands.py  # smg torrent subcommands
│   ├── docker_client.py # Docker SDK wrapper
│   ├── aria2_client.py  # aria2 JSON-RPC client
│   └── log.py           # Shared logging setup
├── web/                 # React/TypeScript Web UI
│   ├── src/
│   │   ├── pages/       # TorrentsPage, MulesPage, ConfigsPage, SettingsPage
│   │   ├── components/  # MuleCard, TorrentRow, StatsBar, SpeedGraph, modals
│   │   └── api/         # Axios client + TypeScript types
│   └── package.json
├── tests/               # 108 unit and integration tests
├── downloads/           # Shared downloads volume (mounted into mules)
├── logs/                # Dated log files (dvd_YYYY-MM-DD_HH-MM-SS.log)
├── .github/
│   └── workflows/
│       ├── python-ci.yml    # Python test matrix (3.12, 3.13) + coverage
│       └── frontend-ci.yml  # TypeScript type-check + Vite build
├── start.sh             # Launch API + frontend together
└── .env                 # DVD_LOGGING, DVD_LOG_LEVEL
```

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

```env
DVD_LOGGING=true
DVD_LOG_LEVEL=INFO
```

## Security notes

- Kill-switch is enforced at the process level: if `wg0` disappears, aria2 is killed with `SIGKILL` before any traffic leaks.
- DNS is switched to the VPN nameserver only after connectivity is verified.
- The VPN endpoint is pinned to avoid routing loops through the tunnel.
- WireGuard private keys are never logged or returned through the API.
- `vpn_configs/` and `downloads/` are gitignored — only `.gitkeep` placeholders are committed.

## Development

```bash
# Run tests
uv run pytest tests/ -v

# Run tests (quiet)
uv run pytest tests/ -q

# Run tests with coverage
uv run pytest tests/ -q --cov=cli --cov=api --cov-report=term-missing

# Run the CLI directly
uv run smg --help
```

## CI

GitHub Actions runs automatically on every push and pull request to `main`.

| Workflow | Trigger | What it does |
|---|---|---|
| **Python CI** | All pushes/PRs | Tests on Python 3.12 + 3.13 via `uv`; coverage report on 3.12 |
| **Frontend CI** | Changes under `web/` | TypeScript type-check (`tsc --noEmit`) + Vite production build |

All tests are fully mocked — no Docker daemon or real WireGuard `.conf` files required in CI.
