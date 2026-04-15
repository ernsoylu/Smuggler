# DVD — Dockerized VPN Downloader

Isolated torrent downloads inside per-worker Docker containers, each behind its own WireGuard VPN tunnel. No torrent process ever starts without a verified VPN connection.

## How it works

1. You supply a WireGuard `.conf` file and start a worker.
2. The worker container sets up `wg0` using raw `wg`/`ip` commands (no `wg-quick`), verifies the external IP through the tunnel, then starts the aria2 daemon.
3. `dvd worker start` blocks until the VPN is confirmed — it only returns once it has the worker's real external IP and country.
4. Workers restart automatically (`unless-stopped`) if the container crashes.
5. A kill-switch watchdog inside the container kills aria2 immediately if `wg0` disappears.
6. You add torrents to the worker via the CLI. All downloads land in the shared `./downloads` folder on the host.

## Requirements

- Docker
- Python 3.12+
- [uv](https://github.com/astral-sh/uv)
- A WireGuard `.conf` file (e.g. from [Mega VPN](https://mega.nz/vpn))

## Installation

```bash
git clone <repo>
cd DVD
uv sync
```

This installs the `dvd` CLI into the project's virtual environment.

## Quick start

```bash
# 1. Build the worker Docker image (one-time)
dvd build

# 2. Drop your WireGuard config into vpn_configs/
cp ~/Downloads/my-vpn.conf vpn_configs/

# 3. Start a worker — blocks until VPN is confirmed, prints external IP on success
dvd worker start --config vpn_configs/my-vpn.conf

# 4. Add a torrent
dvd torrent add dvd-worker-<name> --magnet "magnet:?xt=urn:btih:..."
# or with a .torrent file:
dvd torrent add dvd-worker-<name> --file ~/Downloads/file.torrent

# 5. Monitor progress
dvd torrent list

# 6. Shut down a worker when done
dvd worker stop dvd-worker-<name>

# Or forcefully kill all workers at once
dvd worker kill --all --yes
```

Downloaded files appear in `./downloads/` on your host machine.

## CLI reference

### `dvd build`

Builds the `dvd-worker:latest` Docker image from `worker_image/`.

```
dvd build [--context PATH] [--tag TAG]
```

### `dvd worker`

| Command | Description |
|---|---|
| `dvd worker start --config FILE` | Start a worker — blocks until VPN is confirmed |
| `dvd worker list` | List all workers and their status |
| `dvd worker stop NAME` | Gracefully stop and remove a worker (SIGTERM) |
| `dvd worker stop --keep NAME` | Stop but keep the container |
| `dvd worker ip NAME` | Show the worker's current external IP and geolocation |
| `dvd worker kill NAME` | Force-kill a worker immediately (SIGKILL) |
| `dvd worker kill --all` | Force-kill every worker (prompts for confirmation) |
| `dvd worker kill --all --yes` | Force-kill every worker, skip confirmation |

**`worker start` options:**

| Flag | Description |
|---|---|
| `--config`, `-c` | Path to the WireGuard `.conf` file (required) |
| `--name`, `-n` | Worker name (auto-generated if omitted) |
| `--downloads-dir` | Host directory for downloads (default: `./downloads`) |

**`worker kill` options:**

| Flag | Description |
|---|---|
| `--all` | Kill every worker instead of a named one |
| `--keep` | Kill but do not remove the container |
| `--yes`, `-y` | Skip the confirmation prompt (useful with `--all`) |

### `dvd torrent`

| Command | Description |
|---|---|
| `dvd torrent add WORKER --magnet URI` | Add a magnet link to a worker |
| `dvd torrent add WORKER --file FILE` | Add a `.torrent` file to a worker |
| `dvd torrent list [WORKER]` | List torrents (all workers if WORKER omitted) |
| `dvd torrent remove WORKER GID` | Remove a torrent by GID |
| `dvd torrent pause WORKER GID` | Pause a torrent |
| `dvd torrent resume WORKER GID` | Resume a paused torrent |

## Project layout

```
DVD/
├── worker_image/
│   ├── Dockerfile       # Debian + wireguard-tools + aria2
│   └── startup.sh       # VPN-first boot + kill-switch watchdog
├── cli/
│   ├── main.py          # CLI entry point
│   ├── docker_client.py # Docker SDK wrapper
│   ├── aria2_client.py  # aria2 JSON-RPC client
│   ├── worker_commands.py
│   └── torrent_commands.py
├── tests/               # 82 unit tests
├── downloads/           # Shared downloads volume (host-side)
├── vpn_configs/         # Place .conf files here (gitignored)
└── pyproject.toml
```

## Security notes

- `vpn_configs/*.conf` is gitignored — private keys are never committed.
- Workers require `NET_ADMIN` + `SYS_MODULE` capabilities for WireGuard.
- WireGuard is configured with raw `wg`/`ip` commands (not `wg-quick`) to avoid `sysctl` permission issues inside containers.
- The VPN endpoint is pinned to the original Docker gateway so WireGuard's own UDP traffic never loops through `wg0`.
- DNS is switched to the VPN's nameserver only after external connectivity is confirmed.
- The kill-switch is enforced at the process level inside the container: if `wg0` disappears, aria2 is killed with `SIGKILL` before any traffic can leak to the host IP.

## Development

```bash
# Run tests
uv run pytest tests/ -v

# Run the CLI directly (without installing)
uv run dvd --help
```

## Roadmap

- **Phase 2:** Flask REST API + React/TypeScript web UI with a Deluge-like dashboard (worker management, per-torrent progress, speed graphs).
