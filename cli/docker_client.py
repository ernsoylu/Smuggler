"""Docker SDK wrapper — manages worker container lifecycles."""

from __future__ import annotations

import os
import secrets
import socket
from pathlib import Path
from typing import Optional

import docker
import docker.errors
import docker.models.containers

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
    try:
        client = docker.from_env()
        client.ping()
        return client
    except docker.errors.DockerException as exc:
        raise RuntimeError(
            f"Cannot connect to Docker daemon. Is Docker running?\n  {exc}"
        ) from exc


def _find_free_port() -> int:
    """Bind to port 0 and return the OS-assigned ephemeral port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


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
    if not vpn_config_path.exists():
        raise FileNotFoundError(f"VPN config not found: {vpn_config_path}")

    if downloads_dir is None:
        downloads_dir = Path(os.getcwd()) / "downloads"
    downloads_dir = Path(downloads_dir).resolve()
    downloads_dir.mkdir(parents=True, exist_ok=True)

    rpc_token = secrets.token_urlsafe(24)
    host_port = _find_free_port()
    worker_name = name or f"dvd-worker-{secrets.token_hex(4)}"

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
        )
    except docker.errors.ImageNotFound:
        raise RuntimeError(
            f"Worker image '{WORKER_IMAGE}' not found. Run `dvd build` first."
        )
    except docker.errors.APIError as exc:
        raise RuntimeError(f"Docker API error while starting worker: {exc}") from exc

    return WorkerInfo(container)


def list_workers(client: docker.DockerClient) -> list[WorkerInfo]:
    """Return all containers that have the dvd.worker label (any status)."""
    containers = client.containers.list(
        all=True,
        filters={"label": WORKER_LABEL},
    )
    return [WorkerInfo(c) for c in containers]


def get_worker(client: docker.DockerClient, name_or_id: str) -> WorkerInfo:
    """Fetch a single worker by name or ID; raises RuntimeError if not found."""
    try:
        container = client.containers.get(name_or_id)
    except docker.errors.NotFound:
        raise RuntimeError(f"Worker not found: '{name_or_id}'")
    if WORKER_LABEL not in (container.labels or {}):
        raise RuntimeError(f"Container '{name_or_id}' is not a dvd worker")
    return WorkerInfo(container)


def stop_worker(client: docker.DockerClient, name_or_id: str, remove: bool = True) -> None:
    """Stop (and optionally remove) a worker container."""
    worker = get_worker(client, name_or_id)
    try:
        worker.container.stop(timeout=10)
        if remove:
            worker.container.remove()
    except docker.errors.APIError as exc:
        raise RuntimeError(f"Failed to stop worker '{name_or_id}': {exc}") from exc


def exec_in_worker(client: docker.DockerClient, name_or_id: str, cmd: str) -> str:
    """Run a shell command inside a running worker container and return stdout."""
    worker = get_worker(client, name_or_id)
    if worker.status != "running":
        raise RuntimeError(f"Worker '{name_or_id}' is not running (status={worker.status})")
    try:
        exit_code, output = worker.container.exec_run(cmd, demux=False)
    except docker.errors.APIError as exc:
        raise RuntimeError(f"exec failed in '{name_or_id}': {exc}") from exc
    if exit_code != 0:
        raise RuntimeError(
            f"Command exited with code {exit_code} in '{name_or_id}': {output.decode()}"
        )
    return output.decode().strip()


def build_image(
    client: docker.DockerClient,
    context_path: str | Path,
    tag: str = WORKER_IMAGE,
) -> None:
    """Build the worker Docker image from context_path/Dockerfile."""
    context_path = Path(context_path).resolve()
    if not (context_path / "Dockerfile").exists():
        raise FileNotFoundError(f"No Dockerfile found in {context_path}")
    try:
        _image, _logs = client.images.build(path=str(context_path), tag=tag, rm=True)
    except docker.errors.BuildError as exc:
        raise RuntimeError(f"Image build failed:\n{exc}") from exc
