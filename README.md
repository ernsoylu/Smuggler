# Smuggler — Dockerized VPN Downloader

Isolated torrent downloads inside per-mule Docker containers, each behind its own VPN tunnel (WireGuard or OpenVPN). No torrent process ever starts without a verified VPN connection.

## How it works

1. You supply a WireGuard `.conf` or OpenVPN `.ovpn` file and start a mule (CLI or Web UI).
2. The mule container establishes the VPN (WireGuard via `wg`/`ip` commands, or OpenVPN via the `openvpn` process), verifies the external IP through the tunnel, then starts the aria2 daemon.
3. `smg mule start` blocks until both VPN and aria2 are confirmed ready — it only returns once it has the mule's real external IP and country.
4. Mules restart automatically (`unless-stopped`) if the container crashes.
5. A kill-switch watchdog inside the container kills aria2 immediately if the VPN interface (`wg0` or `tun0`) disappears.
6. You add torrents to the mule via the CLI or Web UI. All downloads land in the shared `./downloads` folder on the host.

## Requirements

- Docker + Docker Compose (for the default stack)
- A WireGuard `.conf` or OpenVPN `.ovpn` file

Optional (only needed for the local dev / CLI workflow):
- Python 3.12+ and [uv](https://github.com/astral-sh/uv)
- Node.js 18+

## Quick start — Docker Compose (recommended)

The default way to run Smuggler is the Docker Compose stack: a gunicorn-backed API container and an nginx-served React UI.

```bash
./start.sh build    # build both images and start the stack
./start.sh stop     # stop the stack
./start.sh prune    # tear down the stack and remove volumes + every lingering mule
```

Once the stack is up, open <http://localhost:8887>. The UI proxies `/api/*` to the API container over the host network, so mule RPC ports on `localhost` are reachable from the API the same way they are when running bare-metal.

### First-time build

`./start.sh build` will also build the two mule worker images (`smuggler-mule:latest` and `smuggler-mule-ovpn:latest`) on first use via the CLI. To build them up front you can run `./setup.sh`, which installs Python/Node dependencies and builds all four images idempotently — useful when you also want the local CLI (`smg`) workflow.

### Local dev mode

```bash
./start.sh debug    # starts Vite dev server + python3 main.py concurrently
```

Use this when iterating on the API or frontend without rebuilding containers.

## Quick start (CLI)

```bash
# WireGuard mule
smg mule start --config vpn_configs/my-vpn.conf

# OpenVPN mule (credentials optional if config uses auth-user-pass)
smg mule start --config vpn_configs/client.ovpn
smg mule start --config vpn_configs/client.ovpn --username user --password pass

# Add a torrent
smg torrent add smuggler-mule-<name> --magnet "magnet:?xt=urn:btih:..."

# Monitor progress
smg torrent list
```

Downloaded files appear in `./downloads/` on your host machine.

## Web UI

With the Docker Compose stack: <http://localhost:8887>.

For local development (Vite dev server + Flask dev server):

```bash
./start.sh debug
```

Or separately:

```bash
# API (port 5050 via gunicorn)
python3 main.py
# or, for the legacy Flask dev server:
uv run python -m api.run

# Frontend (port 5173)
cd web && npm install && npm run dev
```

### Web UI pages

| Page | Description |
|---|---|
| **Torrents** | Live dashboard — global speed stats, per-torrent progress, add/pause/remove (with optional physical file deletion), peer lists with country flags |
| **Mules** | Manage mule containers — start from uploaded config, stop, kill, view external IP. Watchdog panel shows compromised mules with one-click evacuation |
| **Configs** | Upload WireGuard or OpenVPN configs (with optional credential storage); deploy as new mules in one click |
| **Settings** | Configure download directory (validated + writability check), max concurrent downloads, and speed limits |
| **StatusFooter** | Persistent footer: live download/upload speeds, active mule count, expandable panel showing bandwidth history chart + transfer summary (downloaded/uploaded/ratio) + status distribution counts |

## CLI reference

### `smg build`

Builds a mule Docker image.

```
smg build [--vpn-type wireguard|openvpn] [--context PATH] [--tag TAG]
```

Defaults to WireGuard (`smuggler-mule:latest`). Use `--vpn-type openvpn` to build `smuggler-mule-ovpn:latest`.

### `smg mule`

| Command | Description |
|---|---|
| `smg mule start --config FILE` | Start a mule — auto-detects VPN type from file extension |
| `smg mule start --config FILE --vpn-type wireguard\|openvpn` | Override VPN type |
| `smg mule start --config FILE --username U --password P` | Supply OpenVPN credentials |
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
| `DELETE` | `/api/torrents/<mule>/<gid>` | Remove a torrent (append `?delete_files=true` to also delete the downloaded files from disk) |
| `POST` | `/api/torrents/<mule>/<gid>/pause` | Pause a torrent |
| `POST` | `/api/torrents/<mule>/<gid>/resume` | Resume a torrent |
| `GET` | `/api/torrents/<mule>/<gid>/peers` | List peers for a torrent (UI adds country flags via GeoJS) |
| `GET`/`PATCH` | `/api/torrents/<mule>/<gid>/options` | Read/update per-torrent aria2 options |
| `PATCH` | `/api/torrents/<mule>/<gid>/files` | Update file selection in a multi-file torrent |

### Watchdog

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/watchdog/` | Health of all mules + watchdog stats (interval, sweeps, evacuations) |
| `GET` | `/api/watchdog/<mule>` | Last known health of a specific mule |
| `POST` | `/api/watchdog/run` | Trigger an immediate full sweep |
| `POST` | `/api/watchdog/<mule>/evacuate` | Migrate torrents to healthy mules and kill this one |

### Stats / Settings / Configs

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/stats/` | Global speed, counts, and mule total |
| `GET/POST` | `/api/settings/` | Read and update download settings |
| `GET` | `/api/configs/` | List stored VPN configs |
| `POST` | `/api/configs/` | Upload a new VPN config (WireGuard or OpenVPN) |
| `DELETE` | `/api/configs/<id>` | Delete a stored VPN config |
| `POST` | `/api/configs/<id>/deploy` | Deploy a config as a new mule |

## Project layout

```
Smuggler/
├── docker-compose.yml       # Primary stack: smuggler-api + smuggler-ui
├── docker/                  # Dockerfiles + nginx config for the stack
│   ├── Dockerfile.api       # Python 3.11 + gunicorn (--timeout 180 to cover VPN handshake)
│   ├── Dockerfile.web       # Vite build → nginx static serve + /api reverse proxy
│   └── nginx.conf           # proxy_*_timeout synced with gunicorn timeout
├── main.py                  # gunicorn WSGI entry point (imports api.app.create_app)
├── requirements.txt         # API container deps
├── worker_image/            # WireGuard mule image (smuggler-mule:latest)
│   ├── Dockerfile
│   └── startup.sh           # wg setup + aria2 start + kill-switch watchdog
├── worker_image_ovpn/       # OpenVPN mule image (smuggler-mule-ovpn:latest)
│   ├── Dockerfile
│   └── startup.sh           # openvpn + tun0 wait + aria2 start + kill-switch
├── api/                     # Flask REST API
│   ├── app.py               # App factory; verifies download_dir writability at startup
│   ├── mules.py             # /api/mules blueprint
│   ├── torrents.py          # /api/torrents blueprint (incl. optional file deletion)
│   ├── stats.py             # /api/stats blueprint
│   ├── settings.py          # /api/settings blueprint (writability check)
│   ├── configs.py           # /api/configs blueprint (vpn type detection)
│   ├── watchdog.py          # /api/watchdog blueprint + background sweep thread
│   ├── database.py          # SQLite layer (with migration support)
│   └── settings_sync.py     # Propagate settings to running mules
├── cli/                     # Python CLI (smg)
│   ├── main.py              # Entry point
│   ├── mule_commands.py     # smg mule subcommands
│   ├── torrent_commands.py  # smg torrent subcommands
│   ├── docker_client.py     # Docker SDK wrapper — mules, VPN probes (icanhazip + ipinfo), evacuation
│   ├── aria2_client.py      # aria2 JSON-RPC client (incl. remove_download_result)
│   └── log.py               # Shared logging setup
├── web/                     # React/TypeScript Web UI
│   ├── src/
│   │   ├── pages/           # TorrentsPage, MulesPage, ConfigsPage, SettingsPage
│   │   ├── components/      # MuleCard, TorrentRow, StatsBar, SpeedGraph, StatusFooter, DeleteTorrentModal, modals
│   │   └── api/             # Axios client + TypeScript types
│   └── package.json
├── tests/                   # Unit and integration tests
├── downloads/               # Shared downloads volume (mounted into mules)
├── data/                    # Runtime state — SQLite DB + tmp VPN configs (gitignored; contains private keys)
├── logs/                    # Dated log files
├── .github/
│   └── workflows/
│       ├── python-ci.yml    # Python test matrix (3.12, 3.13) + coverage
│       └── frontend-ci.yml  # TypeScript type-check + Vite build
├── setup.sh                 # Install deps + build all four Docker images
├── start.sh                 # docker-compose lifecycle: build | debug | stop | prune
└── .env                     # DVD_LOGGING, DVD_LOG_LEVEL, SMG_HOST_ROOT
```

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

```env
DVD_LOGGING=true
DVD_LOG_LEVEL=INFO
```

When running in Docker Compose, the API container sees the host's project root through `SMG_HOST_ROOT` (wired automatically in `docker-compose.yml`). That is how it resolves the SQLite path (`data/smuggler.db`), downloads directory, and temp VPN config directory to paths that Docker can mount into mule containers.

## Security notes

- Kill-switch is enforced at the process level: if the VPN interface disappears, aria2 is killed with `SIGKILL` before any traffic leaks.
- **Host watchdog** (`api/watchdog.py`) sweeps every running mule on an interval (15s) and evacuates any mule that fails three consecutive health checks — migrating its torrents to a healthy mule before killing the compromised one. Health checks probe the external IP through the VPN interface via `icanhazip.com` (primary) with `ipinfo.io` as a fallback, so transient rate limits on one endpoint do not produce false positives.
- WireGuard: DNS is switched to the VPN nameserver only after connectivity is verified; private keys are never logged or returned through the API.
- OpenVPN: Credentials are written to a `chmod 600` temp file and deleted from disk immediately after `tun0` comes up. They are allowed to be cached in memory to support hourly TLS key renegotiation without requiring the file on disk.
- The VPN server endpoint is pinned to the original gateway before routes change, preventing routing loops.
- `vpn_configs/`, `downloads/`, and `data/` are gitignored — `data/tmp/` contains uploaded VPN configs in plaintext while they are being deployed.

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

All tests are fully mocked — no Docker daemon or real VPN config files required in CI.
