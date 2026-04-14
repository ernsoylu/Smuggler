# Claude Custom Instructions for Torrent VPN Manager

## Project Overview
You are acting as a Senior Full-Stack and DevOps Engineer to assist in building a containerized Torrent Downloader. The application allows users to isolate torrent downloads inside distinct Docker containers (workers). Each worker must establish its own WireGuard VPN connection (using Mega VPN configurations) before starting the torrent client. 

## Technology Stack
- **Backend:** Python 3.12+, Flask, `uv` (for dependency management)
- **Frontend:** TypeScript, React
- **Containerization:** Docker, Docker SDK for Python
- **Networking:** WireGuard
- **Torrent Client:** Deluge RPC / libtorrent (inside containers)
- **Version Control:** Git

## Development Phases
### Phase 1: CLI Implementation & Infrastructure (Current Focus)
1. Initialize the git repository and folder structure.
2. Create the Docker image for the worker (`worker_image/Dockerfile`). The image must:
   - Install WireGuard and the torrent engine (e.g., deluge-daemon, transmission-daemon, or aria2).
   - Implement a startup script that connects to WireGuard first.
   - Implement a kill-switch (if `wg0` drops, kill the torrent process).
3. Build a Python CLI tool using `argparse` or `Click` to:
   - Start a worker container with a specific VPN `.conf` file.
   - Read the container's public IP and geolocation (to verify VPN).
   - Add a torrent (magnet or `.torrent`) to a specific worker.
   - List workers and their download progress.
   - Stop/kill workers.
4. Write comprehensive tests. Do not proceed to Phase 2 until all tests pass.

### Phase 2: Web Interface
1. Build a Flask REST API interacting with the Python Docker SDK and worker RPCs.
2. Build a React + TypeScript frontend.
3. Implement a Deluge-like UI:
   - Worker Management Page (Create, List, View VPN IP/Country, Kill).
   - Download Management Page (Overall progress, Individual item progress, detailed property pane).
   - Add Torrent Modal (File upload or magnet link, plus Worker Selection dropdown).

## Rules & Coding Standards
- **Strict Typing:** Use Python type hints and strict TypeScript interfaces.
- **VPN First:** Never allow a torrent process to start inside a worker without a verified WireGuard handshake.
- **Shared Storage:** All downloaded files must map to the common `/downloads` volume on the host.
- **Error Handling:** Implement robust error handling for Docker socket connection issues and VPN timeouts.
- **File Edits:** When generating code, output the full file paths and specify whether to create or overwrite.
