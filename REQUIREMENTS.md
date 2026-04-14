# Product Requirements Document (PRD)

## L1 Requirements (Business & System Level)
- **L1.1 Isolated Downloads:** The system shall isolate torrent downloading tasks into independent environments to prevent IP leakage and manage network routing securely.
- **L1.2 Multi-VPN Support:** The system shall allow simultaneous connections to different VPN servers by using distinct worker containers.
- **L1.3 Centralized Management:** The system shall provide a unified interface (CLI initially, Web UI eventually) to manage all workers and downloads seamlessly.

## L2 Requirements (User Level)
- **L2.1 Worker Management:** - Users can create a new worker and supply a Mega VPN WireGuard configuration file.
  - Users can view a list of active workers, including their current external IP address and geographical country.
  - Users can terminate/kill active workers.
- **L2.2 Torrent Management:**
  - Users can add torrents using a magnet link or uploading a `.torrent` file.
  - When adding a torrent, the user must be able to select which active worker will handle the download.
  - Users can view a "Deluge-like" dashboard showing:
    - Overall global download/upload progress.
    - Individual torrent progress bars.
    - A detailed property page for a selected torrent (peers, trackers, files, speed graphs).
- **L2.3 File Access:** Users shall be able to access all completed downloads from a single, centralized `downloads` folder on the host machine.

## L3 Requirements (Functional Level)
- **L3.1 Phase 1 (CLI):**
  - Implement a CLI tool handling Docker socket communication to spin up containers.
  - CLI commands to load WireGuard config, start container, check IP (`curl ifconfig.me` equivalent inside container), and submit torrent jobs.
- **L3.2 VPN Enforcement:** The worker container must execute a startup script that runs `wg-quick up wg0` and verifies external connectivity before starting the torrent daemon.
- **L3.3 Docker Integration:** - Host directory `./downloads` must be mounted to `/downloads` inside every worker container.
  - The Python backend will use the `docker` PyPI package to manage container lifecycles.
- **L3.4 Phase 2 (API & Web):**
  - **Flask API:** Create REST endpoints (`/api/workers`, `/api/torrents`) wrapping the CLI/core logic.
  - **React UI:** Implement a single-page application communicating with the Flask backend. Use polling or WebSockets for real-time progress updates.

## L4 Requirements (Non-Functional / Technical)
- **L4.1 Tech Stack:** - Python 3.12+ initialized with `uv`.
  - Frontend built with React and TypeScript.
  - Backend framework: Flask.
- **L4.2 Security & Privacy:**
  - **Kill-switch:** If the WireGuard interface goes down, the container's network must drop, or the torrent daemon must be forcefully killed to prevent fallback to the host IP.
- **L4.3 Version Control:** Project must be initialized as a Git repository from day one.
- **L4.4 Testing:** Unit and integration tests must pass before transitioning from Phase 1 to Phase 2.
