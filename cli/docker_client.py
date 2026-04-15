"""Docker SDK wrapper — manages worker container lifecycles."""

from __future__ import annotations

import json
import os
import secrets
import socket
import time
from pathlib import Path
from typing import Optional

import docker
import docker.errors
import docker.models.containers

from cli.log import get_logger

log = get_logger(__name__)

WORKER_LABEL = "dvd.worker"
WORKER_IMAGE = "dvd-worker:latest"
ARIA2_INTERNAL_PORT = 6800


class WorkerInfo:
    """Parsed view of a running worker container."""

    def __init__(self, container: docker.models.containers.Container) -> None:
        self.container = container
        self.name: str = container.name
        self.id: str = container.short_id
        self.status: str = container.status
        labels = container.labels or {}
        self.rpc_token: str = labels.get("dvd.rpc_token", "")
        self.rpc_port: int = int(labels.get("dvd.rpc_port", "0"))
        self.vpn_config: str = labels.get("dvd.vpn_config", "")

    @property
    def rpc_url(self) -> str:
        return f"http://localhost:{self.rpc_port}/jsonrpc"


def get_docker_client() -> docker.DockerClient:
    """Return a Docker client, raising RuntimeError if the daemon is unreachable."""
    log.debug("get_docker_client: connecting to Docker daemon")
    try:
        client = docker.from_env()
        client.ping()
        log.debug("get_docker_client: connected OK")
        return client
    except docker.errors.DockerException as exc:
        log.error("get_docker_client: cannot connect — %s", exc)
        raise RuntimeError(
            f"Cannot connect to Docker daemon. Is Docker running?\n  {exc}"
        ) from exc


def _find_free_port() -> int:
    """Bind to port 0 and return the OS-assigned ephemeral port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        port = s.getsockname()[1]
    log.debug("_find_free_port: allocated port %d", port)
    return port


def start_worker(
    client: docker.DockerClient,
    vpn_config_path: str | Path,
    name: Optional[str] = None,
    downloads_dir: Optional[str | Path] = None,
) -> WorkerInfo:
    """
    Spin up a new worker container.

    The container requires NET_ADMIN + SYS_MODULE capabilities for WireGuard.
    The VPN config is bind-mounted read-only at /etc/wireguard/wg0.conf.
    Downloads are mapped to ``downloads_dir`` (defaults to ./downloads).
    """
    vpn_config_path = Path(vpn_config_path).resolve()
    log.info("start_worker: vpn_config=%s name=%s", vpn_config_path, name)

    if not vpn_config_path.exists():
        log.error("start_worker: VPN config not found: %s", vpn_config_path)
        raise FileNotFoundError(f"VPN config not found: {vpn_config_path}")

    if downloads_dir is None:
        downloads_dir = Path(os.getcwd()) / "downloads"
    downloads_dir = Path(downloads_dir).resolve()
    downloads_dir.mkdir(parents=True, exist_ok=True)

    rpc_token = secrets.token_urlsafe(24)
    host_port = _find_free_port()
    worker_name = name or f"dvd-worker-{secrets.token_hex(4)}"

    log.info("start_worker: launching container name=%s host_port=%d", worker_name, host_port)

    volumes = {
        str(vpn_config_path): {
            "bind": "/etc/wireguard/wg0.conf",
            "mode": "ro",
        },
        str(downloads_dir): {
            "bind": "/downloads",
            "mode": "rw",
        },
    }

    labels = {
        WORKER_LABEL: "true",
        "dvd.rpc_token": rpc_token,
        "dvd.rpc_port": str(host_port),
        "dvd.vpn_config": vpn_config_path.name,
    }

    try:
        container = client.containers.run(
            image=WORKER_IMAGE,
            name=worker_name,
            detach=True,
            cap_add=["NET_ADMIN", "SYS_MODULE"],
            sysctls={"net.ipv4.conf.all.src_valid_mark": "1"},
            volumes=volumes,
            ports={f"{ARIA2_INTERNAL_PORT}/tcp": host_port},
            environment={"ARIA2_SECRET": rpc_token},
            labels=labels,
            restart_policy={"Name": "unless-stopped"},
        )
    except docker.errors.ImageNotFound:
        msg = f"Worker image '{WORKER_IMAGE}' not found. Run `dvd build` first."
        log.error("start_worker: %s", msg)
        raise RuntimeError(msg)
    except docker.errors.APIError as exc:
        log.error("start_worker: Docker API error — %s", exc)
        raise RuntimeError(f"Docker API error while starting worker: {exc}") from exc

    log.info("start_worker: container started id=%s name=%s", container.short_id, worker_name)
    return WorkerInfo(container)


def wait_for_vpn(
    client: docker.DockerClient,
    name_or_id: str,
    timeout: int = 60,
    poll_interval: int = 3,
) -> dict:
    """
    Block until the worker's VPN is up and ipinfo.io responds.

    Returns the parsed JSON dict from ipinfo.io on success.
    Raises RuntimeError with container logs if the container exits or times out.
    """
    log.info("wait_for_vpn: waiting for VPN on worker=%s (timeout=%ds)", name_or_id, timeout)
    deadline = time.time() + timeout
    last_error = "timed out"

    while time.time() < deadline:
        worker = get_worker(client, name_or_id)
        worker.container.reload()

        status = worker.container.status
        log.debug("wait_for_vpn: worker=%s container_status=%s", name_or_id, status)

        if status == "exited":
            logs = worker.container.logs(tail=40).decode(errors="replace")
            log.error(
                "wait_for_vpn: container exited before VPN came up. worker=%s\n%s",
                name_or_id, logs,
            )
            raise RuntimeError(
                f"Worker container exited before VPN came up.\n\nContainer logs:\n{logs}"
            )

        if status != "running":
            time.sleep(poll_interval)
            continue

        try:
            exit_code, output = worker.container.exec_run(
                "curl -sf --max-time 8 https://ipinfo.io/json",
                demux=False,
            )
            if exit_code == 0 and output:
                info = json.loads(output.decode().strip())
                log.info(
                    "wait_for_vpn: VPN confirmed — worker=%s ip=%s country=%s",
                    name_or_id, info.get("ip"), info.get("country"),
                )
                # VPN is up — now wait for aria2 to start accepting connections
                _wait_for_aria2(worker, deadline)
                return info
            log.debug(
                "wait_for_vpn: curl exit_code=%s output_len=%s — retrying",
                exit_code, len(output) if output else 0,
            )
        except (docker.errors.APIError, json.JSONDecodeError, ValueError) as exc:
            log.debug("wait_for_vpn: exec/parse error — %s", exc)

        last_error = "VPN not ready yet"
        time.sleep(poll_interval)

    log.error("wait_for_vpn: timed out after %ds for worker=%s", timeout, name_or_id)
    raise RuntimeError(f"VPN confirmation timed out after {timeout}s: {last_error}")


def _wait_for_aria2(worker: "WorkerInfo", deadline: float, poll_interval: int = 2) -> None:
    """
    Block until aria2's JSON-RPC port responds inside ``worker``.

    Runs inside the container via nc so it works regardless of host port mapping.
    Silently returns if the deadline is already past (VPN timeout covers it).
    """
    import requests as _requests

    log.info(
        "_wait_for_aria2: waiting for aria2 on port=%d worker=%s",
        worker.rpc_port, worker.name,
    )
    while time.time() < deadline:
        try:
            # Quick health-check via the host-mapped port — same path the API uses
            resp = _requests.post(
                f"http://localhost:{worker.rpc_port}/jsonrpc",
                json={"jsonrpc": "2.0", "id": "dvd", "method": "aria2.getVersion",
                      "params": [f"token:{worker.rpc_token}"]},
                timeout=3,
            )
            if resp.status_code == 200:
                log.info(
                    "_wait_for_aria2: aria2 ready on port=%d worker=%s",
                    worker.rpc_port, worker.name,
                )
                return
        except _requests.exceptions.RequestException as exc:
            log.debug("_wait_for_aria2: not ready yet — %s", exc)
        time.sleep(poll_interval)

    # Deadline exceeded — log and return; the caller's timeout will handle it
    log.warning(
        "_wait_for_aria2: aria2 not ready before deadline worker=%s port=%d — continuing",
        worker.name, worker.rpc_port,
    )


def get_container_logs(client: docker.DockerClient, name_or_id: str, tail: int = 50) -> str:
    """Return the last ``tail`` lines of a container's logs."""
    log.debug("get_container_logs: worker=%s tail=%d", name_or_id, tail)
    worker = get_worker(client, name_or_id)
    return worker.container.logs(tail=tail).decode(errors="replace")


def list_workers(client: docker.DockerClient) -> list[WorkerInfo]:
    """Return all containers that have the dvd.worker label (any status)."""
    log.debug("list_workers: listing all workers")
    containers = client.containers.list(
        all=True,
        filters={"label": WORKER_LABEL},
    )
    workers = [WorkerInfo(c) for c in containers]
    log.debug("list_workers: found %d worker(s)", len(workers))
    return workers


def get_worker(client: docker.DockerClient, name_or_id: str) -> WorkerInfo:
    """Fetch a single worker by name or ID; raises RuntimeError if not found."""
    log.debug("get_worker: looking up worker=%s", name_or_id)
    try:
        container = client.containers.get(name_or_id)
    except docker.errors.NotFound:
        log.warning("get_worker: not found — %s", name_or_id)
        raise RuntimeError(f"Worker not found: '{name_or_id}'")
    if WORKER_LABEL not in (container.labels or {}):
        log.warning("get_worker: container '%s' is not a dvd worker", name_or_id)
        raise RuntimeError(f"Container '{name_or_id}' is not a dvd worker")
    return WorkerInfo(container)


def stop_worker(client: docker.DockerClient, name_or_id: str, remove: bool = True) -> None:
    """Gracefully stop (SIGTERM + wait) and optionally remove a worker container."""
    log.info("stop_worker: worker=%s remove=%s", name_or_id, remove)
    worker = get_worker(client, name_or_id)
    try:
        worker.container.stop(timeout=10)
        log.info("stop_worker: stopped worker=%s", name_or_id)
        if remove:
            worker.container.remove()
            log.info("stop_worker: removed worker=%s", name_or_id)
    except docker.errors.APIError as exc:
        log.error("stop_worker: failed for worker=%s — %s", name_or_id, exc)
        raise RuntimeError(f"Failed to stop worker '{name_or_id}': {exc}") from exc


def kill_worker(client: docker.DockerClient, name_or_id: str, remove: bool = True) -> None:
    """Immediately kill (SIGKILL) and optionally remove a worker container."""
    log.info("kill_worker: worker=%s remove=%s", name_or_id, remove)
    worker = get_worker(client, name_or_id)
    try:
        if worker.container.status == "running":
            worker.container.kill()
            log.info("kill_worker: killed worker=%s", name_or_id)
        if remove:
            worker.container.remove()
            log.info("kill_worker: removed worker=%s", name_or_id)
    except docker.errors.APIError as exc:
        log.error("kill_worker: failed for worker=%s — %s", name_or_id, exc)
        raise RuntimeError(f"Failed to kill worker '{name_or_id}': {exc}") from exc


def kill_all_workers(client: docker.DockerClient, remove: bool = True) -> list[str]:
    """
    Immediately kill every dvd worker container.

    Returns the list of names that were killed.  Errors per-container are
    collected and re-raised together after all workers have been attempted.
    """
    log.info("kill_all_workers: remove=%s", remove)
    workers = list_workers(client)
    if not workers:
        log.info("kill_all_workers: no workers found")
        return []

    killed: list[str] = []
    errors: list[str] = []

    for w in workers:
        try:
            kill_worker(client, w.name, remove=remove)
            killed.append(w.name)
        except RuntimeError as exc:
            log.error("kill_all_workers: error killing %s — %s", w.name, exc)
            errors.append(str(exc))

    log.info("kill_all_workers: killed=%d errors=%d", len(killed), len(errors))
    if errors:
        raise RuntimeError(
            f"Killed {len(killed)} worker(s), but {len(errors)} error(s) occurred:\n"
            + "\n".join(f"  • {e}" for e in errors)
        )

    return killed


def exec_in_worker(client: docker.DockerClient, name_or_id: str, cmd: str) -> str:
    """Run a shell command inside a running worker container and return stdout."""
    log.debug("exec_in_worker: worker=%s cmd=%r", name_or_id, cmd)
    worker = get_worker(client, name_or_id)
    if worker.status != "running":
        raise RuntimeError(f"Worker '{name_or_id}' is not running (status={worker.status})")
    try:
        exit_code, output = worker.container.exec_run(cmd, demux=False)
    except docker.errors.APIError as exc:
        log.error("exec_in_worker: API error — worker=%s cmd=%r exc=%s", name_or_id, cmd, exc)
        raise RuntimeError(f"exec failed in '{name_or_id}': {exc}") from exc
    if exit_code != 0:
        decoded = output.decode() if output else ""
        # 28 = curl timeout, 137 = SIGKILL (container restart mid-exec)
        # These are soft/expected failures; callers decide severity.
        log.debug(
            "exec_in_worker: non-zero exit worker=%s code=%d output=%r",
            name_or_id, exit_code, decoded,
        )
        raise RuntimeError(
            f"Command exited with code {exit_code} in '{name_or_id}': {decoded}"
        )
    return output.decode().strip()


def build_image(
    client: docker.DockerClient,
    context_path: str | Path,
    tag: str = WORKER_IMAGE,
) -> None:
    """Build the worker Docker image from context_path/Dockerfile."""
    context_path = Path(context_path).resolve()
    log.info("build_image: context=%s tag=%s", context_path, tag)
    if not (context_path / "Dockerfile").exists():
        raise FileNotFoundError(f"No Dockerfile found in {context_path}")
    try:
        _image, _logs = client.images.build(path=str(context_path), tag=tag, rm=True)
        log.info("build_image: built successfully tag=%s", tag)
    except docker.errors.BuildError as exc:
        log.error("build_image: build failed — %s", exc)
        raise RuntimeError(f"Image build failed:\n{exc}") from exc
