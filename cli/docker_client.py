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

MULE_LABEL = "smuggler.mule"
MULE_IMAGE = "smuggler-mule:latest"
MULE_IMAGE_OVPN = "smuggler-mule-ovpn:latest"
ARIA2_INTERNAL_PORT = 6800


class MuleInfo:
    """Parsed view of a running mule container."""

    def __init__(self, container: docker.models.containers.Container) -> None:
        self.container = container
        self.name: str = container.name
        self.id: str = container.short_id
        self.status: str = container.status
        labels = container.labels or {}
        self.rpc_token: str = labels.get("smuggler.rpc_token", "")
        self.rpc_port: int = int(labels.get("smuggler.rpc_port", "0"))
        self.vpn_config: str = labels.get("smuggler.vpn_config", "")
        self.vpn_type: str = labels.get("smuggler.vpn_type", "wireguard")

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


def start_mule(
    client: docker.DockerClient,
    vpn_config_path: str | Path,
    name: Optional[str] = None,
    downloads_dir: Optional[str | Path] = None,
    vpn_type: str = "wireguard",
    ovpn_username: Optional[str] = None,
    ovpn_password: Optional[str] = None,
) -> MuleInfo:
    """
    Spin up a new mule container.

    For WireGuard (vpn_type='wireguard'):
      - Uses image smuggler-mule:latest
      - Config mounted at /etc/wireguard/wg0.conf
      - Requires NET_ADMIN + SYS_MODULE capabilities

    For OpenVPN (vpn_type='openvpn'):
      - Uses image smuggler-mule-ovpn:latest
      - Config mounted at /etc/openvpn/client.ovpn
      - Credentials passed as OVPN_USERNAME / OVPN_PASSWORD env vars
      - Only requires NET_ADMIN capability
    """
    vpn_config_path = Path(vpn_config_path).resolve()
    log.info("start_mule: vpn_config=%s name=%s vpn_type=%s", vpn_config_path, name, vpn_type)

    if not vpn_config_path.exists():
        log.error("start_mule: VPN config not found: %s", vpn_config_path)
        raise FileNotFoundError(f"VPN config not found: {vpn_config_path}")

    if downloads_dir is None:
        downloads_dir = Path(os.getcwd()) / "downloads"
    downloads_dir = Path(downloads_dir).resolve()
    downloads_dir.mkdir(parents=True, exist_ok=True)

    rpc_token = secrets.token_urlsafe(24)
    host_port = _find_free_port()
    worker_name = name or f"smuggler-mule-{secrets.token_hex(4)}"

    log.info("start_mule: launching container name=%s host_port=%d", worker_name, host_port)

    if vpn_type == "openvpn":
        image = MULE_IMAGE_OVPN
        container_config_path = "/etc/openvpn/client.ovpn"
        cap_add = ["NET_ADMIN"]
        sysctls: dict = {}
    else:
        image = MULE_IMAGE
        container_config_path = "/etc/wireguard/wg0.conf"
        cap_add = ["NET_ADMIN", "SYS_MODULE"]
        sysctls = {"net.ipv4.conf.all.src_valid_mark": "1"}

    volumes = {
        str(vpn_config_path): {"bind": container_config_path, "mode": "ro"},
        str(downloads_dir): {"bind": "/downloads", "mode": "rw"},
    }

    environment: dict = {"ARIA2_SECRET": rpc_token}
    if vpn_type == "openvpn" and ovpn_username:
        environment["OVPN_USERNAME"] = ovpn_username
    if vpn_type == "openvpn" and ovpn_password:
        environment["OVPN_PASSWORD"] = ovpn_password

    labels = {
        MULE_LABEL: "true",
        "smuggler.rpc_token": rpc_token,
        "smuggler.rpc_port": str(host_port),
        "smuggler.vpn_config": vpn_config_path.name,
        "smuggler.vpn_type": vpn_type,
    }

    run_kwargs: dict = dict(
        image=image,
        name=worker_name,
        detach=True,
        cap_add=cap_add,
        volumes=volumes,
        ports={f"{ARIA2_INTERNAL_PORT}/tcp": host_port},
        environment=environment,
        labels=labels,
        restart_policy={"Name": "unless-stopped"},
    )
    if sysctls:
        run_kwargs["sysctls"] = sysctls

    try:
        container = client.containers.run(**run_kwargs)
    except docker.errors.ImageNotFound:
        msg = f"Mule image '{image}' not found. Run `smg build` first."
        log.error("start_mule: %s", msg)
        raise RuntimeError(msg)
    except docker.errors.APIError as exc:
        log.error("start_mule: Docker API error — %s", exc)
        raise RuntimeError(f"Docker API error while starting mule: {exc}") from exc

    log.info("start_mule: container started id=%s name=%s", container.short_id, worker_name)
    return MuleInfo(container)


def wait_for_vpn(
    client: docker.DockerClient,
    name_or_id: str,
    timeout: int = 60,
    poll_interval: int = 3,
) -> dict:
    """
    Block until the mule's VPN is up and ipinfo.io responds.

    Returns the parsed JSON dict from ipinfo.io on success.
    Raises RuntimeError with container logs if the container exits or times out.
    """
    log.info("wait_for_vpn: waiting for VPN on mule=%s (timeout=%ds)", name_or_id, timeout)
    deadline = time.time() + timeout
    last_error = "timed out"

    while time.time() < deadline:
        mule = get_mule(client, name_or_id)
        mule.container.reload()

        status = mule.container.status
        log.debug("wait_for_vpn: mule=%s container_status=%s", name_or_id, status)

        if status == "exited":
            logs = mule.container.logs(tail=40).decode(errors="replace")
            log.error(
                "wait_for_vpn: container exited before VPN came up. mule=%s\n%s",
                name_or_id, logs,
            )
            raise RuntimeError(
                f"Mule container exited before VPN came up.\n\nContainer logs:\n{logs}"
            )

        if status != "running":
            time.sleep(poll_interval)
            continue

        try:
            exit_code, output = mule.container.exec_run(
                "curl -sf --max-time 8 https://ipinfo.io/json",
                demux=False,
            )
            if exit_code == 0 and output:
                info = json.loads(output.decode().strip())
                log.info(
                    "wait_for_vpn: VPN confirmed — mule=%s ip=%s country=%s",
                    name_or_id, info.get("ip"), info.get("country"),
                )
                # VPN is up — now wait for aria2 to start accepting connections
                _wait_for_aria2(mule, deadline)
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


def _wait_for_aria2(mule: MuleInfo, deadline: float, poll_interval: int = 2) -> None:
    """
    Block until aria2's JSON-RPC port responds inside ``mule``.

    Runs inside the container via nc so it works regardless of host port mapping.
    Silently returns if the deadline is already past (VPN timeout covers it).
    """
    import requests as _requests

    log.info(
        "_wait_for_aria2: waiting for aria2 on port=%d mule=%s",
        mule.rpc_port, mule.name,
    )
    while time.time() < deadline:
        try:
            # Quick health-check via the host-mapped port — same path the API uses
            resp = _requests.post(
                f"http://localhost:{mule.rpc_port}/jsonrpc",
                json={"jsonrpc": "2.0", "id": "smuggler", "method": "aria2.getVersion",
                      "params": [f"token:{mule.rpc_token}"]},
                timeout=3,
            )
            if resp.status_code == 200:
                log.info(
                    "_wait_for_aria2: aria2 ready on port=%d mule=%s",
                    mule.rpc_port, mule.name,
                )
                return
        except _requests.exceptions.RequestException as exc:
            log.debug("_wait_for_aria2: not ready yet — %s", exc)
        time.sleep(poll_interval)

    # Deadline exceeded — log and return; the caller's timeout will handle it
    log.warning(
        "_wait_for_aria2: aria2 not ready before deadline mule=%s port=%d — continuing",
        mule.name, mule.rpc_port,
    )


def get_container_logs(client: docker.DockerClient, name_or_id: str, tail: int = 50) -> str:
    """Return the last ``tail`` lines of a container's logs."""
    log.debug("get_container_logs: mule=%s tail=%d", name_or_id, tail)
    mule = get_mule(client, name_or_id)
    return mule.container.logs(tail=tail).decode(errors="replace")


def list_mules(client: docker.DockerClient) -> list[MuleInfo]:
    """Return all containers that have the smuggler.mule label (any status)."""
    log.debug("list_mules: listing all mules")
    containers = client.containers.list(
        all=True,
        filters={"label": MULE_LABEL},
    )
    mules = [MuleInfo(c) for c in containers]
    log.debug("list_mules: found %d mule(s)", len(mules))
    return mules


def get_mule(client: docker.DockerClient, name_or_id: str) -> MuleInfo:
    """Fetch a single mule by name or ID; raises RuntimeError if not found."""
    log.debug("get_mule: looking up mule=%s", name_or_id)
    try:
        container = client.containers.get(name_or_id)
    except docker.errors.NotFound:
        log.warning("get_mule: not found — %s", name_or_id)
        raise RuntimeError(f"Mule not found: '{name_or_id}'")
    if MULE_LABEL not in (container.labels or {}):
        log.warning("get_mule: container '%s' is not a smuggler mule", name_or_id)
        raise RuntimeError(f"Container '{name_or_id}' is not a smuggler mule")
    return MuleInfo(container)


def stop_mule(client: docker.DockerClient, name_or_id: str, remove: bool = True) -> None:
    """Gracefully stop (SIGTERM + wait) and optionally remove a mule container."""
    log.info("stop_mule: mule=%s remove=%s", name_or_id, remove)
    mule = get_mule(client, name_or_id)
    try:
        mule.container.stop(timeout=10)
        log.info("stop_mule: stopped mule=%s", name_or_id)
        if remove:
            mule.container.remove()
            log.info("stop_mule: removed mule=%s", name_or_id)
    except docker.errors.APIError as exc:
        log.error("stop_mule: failed for mule=%s — %s", name_or_id, exc)
        raise RuntimeError(f"Failed to stop mule '{name_or_id}': {exc}") from exc


def kill_mule(client: docker.DockerClient, name_or_id: str, remove: bool = True) -> None:
    """Immediately kill (SIGKILL) and optionally remove a mule container."""
    log.info("kill_mule: mule=%s remove=%s", name_or_id, remove)
    mule = get_mule(client, name_or_id)
    try:
        if mule.container.status == "running":
            mule.container.kill()
            log.info("kill_mule: killed mule=%s", name_or_id)
        if remove:
            mule.container.remove()
            log.info("kill_mule: removed mule=%s", name_or_id)
    except docker.errors.APIError as exc:
        log.error("kill_mule: failed for mule=%s — %s", name_or_id, exc)
        raise RuntimeError(f"Failed to kill mule '{name_or_id}': {exc}") from exc


def kill_all_mules(client: docker.DockerClient, remove: bool = True) -> list[str]:
    """
    Immediately kill every smuggler mule container.

    Returns the list of names that were killed.  Errors per-container are
    collected and re-raised together after all mules have been attempted.
    """
    log.info("kill_all_mules: remove=%s", remove)
    mules = list_mules(client)
    if not mules:
        log.info("kill_all_mules: no mules found")
        return []

    killed: list[str] = []
    errors: list[str] = []

    for m in mules:
        try:
            kill_mule(client, m.name, remove=remove)
            killed.append(m.name)
        except RuntimeError as exc:
            log.error("kill_all_mules: error killing %s — %s", m.name, exc)
            errors.append(str(exc))

    log.info("kill_all_mules: killed=%d errors=%d", len(killed), len(errors))
    if errors:
        raise RuntimeError(
            f"Killed {len(killed)} mule(s), but {len(errors)} error(s) occurred:\n"
            + "\n".join(f"  • {e}" for e in errors)
        )

    return killed


def exec_in_mule(client: docker.DockerClient, name_or_id: str, cmd: str) -> str:
    """Run a shell command inside a running mule container and return stdout."""
    log.debug("exec_in_mule: mule=%s cmd=%r", name_or_id, cmd)
    mule = get_mule(client, name_or_id)
    if mule.status != "running":
        raise RuntimeError(f"Mule '{name_or_id}' is not running (status={mule.status})")
    try:
        exit_code, output = mule.container.exec_run(cmd, demux=False)
    except docker.errors.APIError as exc:
        log.error("exec_in_mule: API error — mule=%s cmd=%r exc=%s", name_or_id, cmd, exc)
        raise RuntimeError(f"exec failed in '{name_or_id}': {exc}") from exc
    if exit_code != 0:
        decoded = output.decode() if output else ""
        # 28 = curl timeout, 137 = SIGKILL (container restart mid-exec)
        # These are soft/expected failures; callers decide severity.
        log.debug(
            "exec_in_mule: non-zero exit mule=%s code=%d output=%r",
            name_or_id, exit_code, decoded,
        )
        raise RuntimeError(
            f"Command exited with code {exit_code} in '{name_or_id}': {decoded}"
        )
    return output.decode().strip()


def build_image(
    client: docker.DockerClient,
    context_path: str | Path,
    tag: str = MULE_IMAGE,
) -> None:
    """Build the mule Docker image from context_path/Dockerfile."""
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
