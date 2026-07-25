"""Docker SDK wrapper — manages worker container lifecycles."""

from __future__ import annotations

import json
import os
import re
import secrets
import socket
import time
from pathlib import Path
from typing import Optional

import docker
import docker.errors
import docker.models.containers

from cli.aria2_client import Aria2Client
from cli.log import get_logger, log_safe

log = get_logger(__name__)

MULE_LABEL = "smuggler.mule"
MULE_IMAGE = "smuggler-mule:latest"
MULE_IMAGE_OVPN = "smuggler-mule-ovpn:latest"
ARIA2_INTERNAL_PORT = 6800

# Internal Docker network shared by the API and every mule, carrying only aria2
# RPC. Created by docker-compose; declared here because start_mule attaches to
# it. It is an `internal` network — verified to have no default route, no DNS
# egress and no raw IP egress — so it cannot become a leak path for a mule.
MULE_RPC_NETWORK = os.environ.get("SMG_RPC_NETWORK", "smuggler-rpc")


def _rpc_over_container_network() -> bool:
    """True when RPC should be addressed by container name instead of loopback.

    The API sets this in docker-compose, where it shares ``MULE_RPC_NETWORK``
    with the mules. Host-side callers — the ``smg`` CLI and ``start.sh debug``,
    which run outside Docker — leave it unset and keep using the published
    loopback port, which is why mules still publish one.
    """
    return os.environ.get("SMG_MULE_RPC_HOST", "").strip().lower() == "container"


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
        cfg_id = labels.get("smuggler.config_id", "")
        try:
            self.config_id: int | None = int(cfg_id) if cfg_id else None
        except ValueError:
            self.config_id = None

    @property
    def rpc_host(self) -> str:
        """Host to dial for this mule's aria2 RPC.

        In-container callers use the mule's container name over the internal RPC
        network; host callers use the loopback-published port.
        """
        return self.name if _rpc_over_container_network() else "localhost"

    @property
    def rpc_target_port(self) -> int:
        """Port that pairs with :attr:`rpc_host`.

        Container-network callers hit aria2 directly on 6800; host callers go
        through the published ephemeral port.
        """
        return ARIA2_INTERNAL_PORT if _rpc_over_container_network() else self.rpc_port

    @property
    def rpc_url(self) -> str:
        return f"http://{self.rpc_host}:{self.rpc_target_port}/jsonrpc"


def aria2_for(mule: MuleInfo, timeout: int | None = None) -> Aria2Client:
    """Build an Aria2Client addressed correctly for where this process runs.

    Centralised so the loopback-vs-container-network decision lives in exactly
    one place rather than at each of the call sites that used to hardcode
    ``host="localhost"``.
    """
    kwargs = {"timeout": timeout} if timeout is not None else {}
    return Aria2Client(
        host=mule.rpc_host,
        port=mule.rpc_target_port,
        token=mule.rpc_token,
        **kwargs,
    )


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


def _attach_rpc_network(
    client: docker.DockerClient,
    container: docker.models.containers.Container,
    name: str,
) -> None:
    """Attach a mule to the internal RPC network, if that network exists.

    Added as a second interface *after* the container is created, so the mule
    keeps its normal bridge as the default route — the kill-switch derives the
    interface it seals from that default route, and an internal network never
    provides one.

    Best-effort by design: when the network is absent (a bare ``smg`` run with
    no compose stack) the mule still works over its published loopback port, so
    a missing network must not fail the deploy.
    """
    try:
        network = client.networks.get(MULE_RPC_NETWORK)
    except docker.errors.NotFound:
        log.debug(
            "_attach_rpc_network: network %s not present — mule %s will be "
            "reachable over its published loopback port only",
            MULE_RPC_NETWORK, log_safe(name),
        )
        return
    except docker.errors.APIError as exc:
        log.warning("_attach_rpc_network: could not look up %s — %s", MULE_RPC_NETWORK, exc)
        return

    try:
        network.connect(container)
        log.info("_attach_rpc_network: mule=%s joined %s", log_safe(name), MULE_RPC_NETWORK)
    except docker.errors.APIError as exc:
        log.warning(
            "_attach_rpc_network: mule=%s could not join %s — %s",
            log_safe(name), MULE_RPC_NETWORK, exc,
        )


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
    config_id: Optional[int] = None,
) -> MuleInfo:
    """
    Spin up a new mule container.

    For WireGuard (vpn_type='wireguard'):
      - Uses image smuggler-mule:latest
      - Config mounted at /etc/wireguard/wg0.conf
      - Requires only NET_ADMIN. The ``wireguard`` kernel module must already be
        loaded on the host (``modprobe wireguard`` — setup.sh does this); we do
        NOT grant CAP_SYS_MODULE, which would let a compromised mule load
        arbitrary modules into the host kernel (full host takeover).

    For OpenVPN (vpn_type='openvpn'):
      - Uses image smuggler-mule-ovpn:latest
      - Config mounted at /etc/openvpn/client.ovpn
      - Credentials passed as OVPN_USERNAME / OVPN_PASSWORD env vars
      - Only requires NET_ADMIN capability
    """
    vpn_config_path = Path(vpn_config_path).resolve()
    log.info("start_mule: vpn_config=%s name=%s vpn_type=%s", vpn_config_path, log_safe(name), vpn_type)

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

    log.info("start_mule: launching container name=%s host_port=%d", log_safe(worker_name), host_port)

    if vpn_type == "openvpn":
        image = MULE_IMAGE_OVPN
        container_config_path = "/etc/openvpn/client.ovpn"
        cap_add = ["NET_ADMIN"]
        sysctls: dict = {}
        # OpenVPN requires the host TUN/TAP device to create tun0 inside the container
        devices = ["/dev/net/tun:/dev/net/tun:rwm"]
    else:
        image = MULE_IMAGE
        container_config_path = "/etc/wireguard/wg0.conf"
        # NET_ADMIN only — configuring an existing wg interface needs it, but we
        # deliberately do NOT add SYS_MODULE (host-kernel module loading = escape
        # primitive). The host must have the wireguard module loaded already.
        cap_add = ["NET_ADMIN"]
        sysctls = {"net.ipv4.conf.all.src_valid_mark": "1"}
        devices = []

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
    if config_id is not None:
        labels["smuggler.config_id"] = str(config_id)

    run_kwargs: dict = {
        "image": image,
        "name": worker_name,
        "detach": True,
        "cap_add": cap_add,
        "volumes": volumes,
        # Publish the aria2 RPC port on the loopback interface ONLY. Host-side
        # callers (the smg CLI, ./start.sh debug) reach it via 127.0.0.1;
        # binding to 0.0.0.0 would expose the token-gated RPC to the whole LAN.
        # Containerised callers prefer the internal RPC network attached below.
        "ports": {f"{ARIA2_INTERNAL_PORT}/tcp": ("127.0.0.1", host_port)},
        "environment": environment,
        "labels": labels,
        "restart_policy": {"Name": "unless-stopped"},
    }
    if sysctls:
        run_kwargs["sysctls"] = sysctls
    if devices:
        run_kwargs["devices"] = devices

    try:
        container = client.containers.run(**run_kwargs)
    except docker.errors.ImageNotFound:
        msg = f"Mule image '{image}' not found. Run `smg build` first."
        log.error("start_mule: %s", msg)
        raise RuntimeError(msg)
    except docker.errors.APIError as exc:
        log.error("start_mule: Docker API error — %s", exc)
        raise RuntimeError(f"Docker API error while starting mule: {exc}") from exc

    _attach_rpc_network(client, container, worker_name)

    log.info("start_mule: container started id=%s name=%s", container.short_id, log_safe(worker_name))
    return MuleInfo(container)


def wait_for_vpn(
    client: docker.DockerClient,
    name_or_id: str,
    timeout: int = 60,
    poll_interval: int = 3,
) -> dict:
    """
    Block until the mule's VPN is confirmed up.

    Returns a dict of exit-node metadata. ipinfo.io is tried first for the rich
    fields (city/region/country), falling back to icanhazip for a bare ``ip``:
    proving the tunnel routes is the actual gate, and a single third party being
    rate-limited must not be able to fail every deployment.

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

        # Bind the probes to the tunnel interface so this startup check never
        # egresses via eth0 (which would reveal the real IP to the probe endpoint
        # before routing settles).
        vpn_iface = "tun0" if mule.vpn_type == "openvpn" else "wg0"
        info: dict | None = None

        try:
            exit_code, output = mule.container.exec_run(
                f"curl -sf --interface {vpn_iface} --max-time 8 https://ipinfo.io/json",
                demux=False,
            )
            if exit_code == 0 and output:
                info = json.loads(output.decode().strip())
        except (docker.errors.APIError, ValueError) as exc:
            log.debug("wait_for_vpn: ipinfo exec/parse error — %s", exc)

        if not info or not info.get("ip"):
            # ipinfo is unavailable or rate-limited — fall back to the plain-text
            # probe. Less metadata, same proof that the tunnel is routing.
            ip, reason = _probe_icanhazip(mule.container, vpn_iface)
            if ip:
                log.info(
                    "wait_for_vpn: ipinfo unavailable, confirmed via icanhazip — "
                    "mule=%s ip=%s", name_or_id, ip,
                )
                info = {"ip": ip}
            else:
                info = None
                last_error = f"VPN not ready yet ({reason})"

        if info:
            log.info(
                "wait_for_vpn: VPN confirmed — mule=%s ip=%s country=%s",
                name_or_id, info.get("ip"), info.get("country"),
            )
            # VPN is up — now wait for aria2 to start accepting connections
            _wait_for_aria2(mule, deadline)
            return info

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
        "_wait_for_aria2: waiting for aria2 at %s mule=%s", mule.rpc_url, mule.name,
    )
    while time.time() < deadline:
        try:
            # Same address the API itself will use — container name over the
            # internal RPC network in the compose topology, published loopback
            # port on the host. Hardcoding localhost here made this poll a no-op
            # inside the API container, so deploys returned before aria2 was up.
            resp = _requests.post(
                mule.rpc_url,
                json={"jsonrpc": "2.0", "id": "smuggler", "method": "aria2.getVersion",
                      "params": [f"token:{mule.rpc_token}"]},
                timeout=3,
            )
            if resp.status_code == 200:
                log.info(
                    "_wait_for_aria2: aria2 ready at %s mule=%s", mule.rpc_url, mule.name,
                )
                return
        except _requests.exceptions.RequestException as exc:
            log.debug("_wait_for_aria2: not ready yet — %s", exc)
        time.sleep(poll_interval)

    # Deadline exceeded — log and return; the caller's timeout will handle it
    log.warning(
        "_wait_for_aria2: aria2 not ready before deadline mule=%s at %s — continuing",
        mule.name, mule.rpc_url,
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
    safe = log_safe(name_or_id)
    log.debug("get_mule: looking up mule=%s", safe)
    try:
        container = client.containers.get(name_or_id)
    except docker.errors.NotFound:
        log.warning("get_mule: not found — %s", safe)
        raise RuntimeError(f"Mule not found: '{name_or_id}'")
    if MULE_LABEL not in (container.labels or {}):
        log.warning("get_mule: container '%s' is not a smuggler mule", safe)
        raise RuntimeError(f"Container '{name_or_id}' is not a smuggler mule")
    return MuleInfo(container)


def stop_mule(client: docker.DockerClient, name_or_id: str, remove: bool = True) -> None:
    """Gracefully stop (SIGTERM + wait) and optionally remove a mule container."""
    safe = log_safe(name_or_id)
    log.info("stop_mule: mule=%s remove=%s", safe, remove)
    mule = get_mule(client, name_or_id)
    try:
        mule.container.stop(timeout=10)
        log.info("stop_mule: stopped mule=%s", safe)
        if remove:
            mule.container.remove()
            log.info("stop_mule: removed mule=%s", safe)
    except docker.errors.APIError as exc:
        log.error("stop_mule: failed for mule=%s — %s", safe, exc)
        raise RuntimeError(f"Failed to stop mule '{name_or_id}': {exc}") from exc


def kill_mule(client: docker.DockerClient, name_or_id: str, remove: bool = True) -> None:
    """Immediately kill (SIGKILL) and optionally remove a mule container."""
    safe = log_safe(name_or_id)
    log.info("kill_mule: mule=%s remove=%s", safe, remove)
    mule = get_mule(client, name_or_id)
    try:
        if mule.container.status == "running":
            mule.container.kill()
            log.info("kill_mule: killed mule=%s", safe)
        if remove:
            mule.container.remove()
            log.info("kill_mule: removed mule=%s", safe)
    except docker.errors.APIError as exc:
        log.error("kill_mule: failed for mule=%s — %s", safe, exc)
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
        log.error("exec_in_mule: API error — mule=%s cmd=%r exc=%s", log_safe(name_or_id), cmd, exc)
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


_PRIVATE_IP_PATTERN = re.compile(
    r"^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.)"
)
_IPV4_PATTERN = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")


def _probe_icanhazip(container, vpn_iface: str) -> tuple[str | None, str]:
    """Probe icanhazip.com; return ``(ip, reason_on_failure)``."""
    try:
        exit_code, output = container.exec_run(
            f"curl -sf --interface {vpn_iface} --max-time 8 https://icanhazip.com",
            demux=False,
        )
    except docker.errors.APIError as exc:
        return None, f"exec error on icanhazip: {exc}"

    if exit_code != 0 or not output:
        return None, f"icanhazip failed (exit={exit_code})"

    lines = output.decode(errors="replace").strip().splitlines()
    ip = lines[-1].strip() if lines else ""
    if _IPV4_PATTERN.match(ip):
        return ip, ""
    return None, "icanhazip returned unexpected body"


def _probe_ipinfo(container, vpn_iface: str) -> tuple[str | None, str | None, str]:
    """Probe ipinfo.io; return ``(ip, country, reason_on_failure)``."""
    try:
        exit_code, output = container.exec_run(
            f"curl -sf --interface {vpn_iface} --max-time 8 https://ipinfo.io/json",
            demux=False,
        )
    except docker.errors.APIError as exc:
        return None, None, f"exec error on ipinfo: {exc}"

    if exit_code != 0 or not output:
        return None, None, f"ipinfo failed (exit={exit_code})"

    try:
        info = json.loads(output.decode(errors="replace").strip())
    except ValueError as exc:
        return None, None, f"bad JSON from ipinfo: {exc}"

    ip = info.get("ip") or ""
    if not ip:
        return None, None, "ipinfo.io returned no IP field"
    return ip, info.get("country") or None, ""


def _probe_vpn_ip(container, vpn_iface: str) -> tuple[str | None, str | None, str]:
    """
    Probe the external IP through *vpn_iface*.

    Tries icanhazip.com first (plain text, rarely rate-limited) and only
    falls back to ipinfo.io for the richer JSON metadata. Either success
    proves the tunnel is routing traffic.

    Returns ``(ip, country, reason)``. ``ip`` is ``None`` when both probes
    fail; ``country`` is populated only when ipinfo.io responded.
    """
    ip, first_reason = _probe_icanhazip(container, vpn_iface)
    if ip:
        return ip, None, f"VPN OK — {ip}"

    ip, country, second_reason = _probe_ipinfo(container, vpn_iface)
    if not ip:
        return (
            None,
            None,
            f"{first_reason}; {second_reason} — no connectivity through {vpn_iface}",
        )

    reason = f"VPN OK — {ip}" + (f" ({country})" if country else "")
    return ip, country, reason


def _probe_default_route_ip(container) -> tuple[str | None, str]:
    """Probe the external IP via the *default route* (no ``--interface`` binding).

    This reflects the path aria2's own traffic takes. Compared against the
    interface-bound probe, a mismatch reveals that the container's default route
    is not the VPN tunnel (e.g. an OpenVPN config without ``redirect-gateway``),
    which the interface-bound probe alone cannot detect. Returns ``(ip, reason)``;
    ``ip`` is ``None`` when the probe fails (which, when the tunnel probe
    succeeded, means egress is blocked rather than leaking).
    """
    try:
        exit_code, output = container.exec_run(
            "curl -sf --max-time 8 https://icanhazip.com",
            demux=False,
        )
    except docker.errors.APIError as exc:
        return None, f"exec error on default-route probe: {exc}"
    if exit_code != 0 or not output:
        return None, f"default-route probe failed (exit={exit_code})"
    lines = output.decode(errors="replace").strip().splitlines()
    ip = lines[-1].strip() if lines else ""
    if _IPV4_PATTERN.match(ip):
        return ip, ""
    return None, "default-route probe returned unexpected body"


def check_mule_vpn(client: docker.DockerClient, name_or_id: str) -> dict:
    """
    Verify that a running mule's traffic is still exiting through the VPN.

    Runs two probes bound to the VPN interface (icanhazip.com primary,
    ipinfo.io fallback) and checks that:
      - at least one probe succeeds
      - the returned IP is not a private/Docker address

    Returns a dict::

        {
          "name":    str,
          "healthy": bool,
          "ip":      str | None,   # current external IP (or None on failure)
          "reason":  str,          # human-readable status
          "kind":    str,          # failure kind when unhealthy —
                                   # "healthy", "probe_failed", "ip_leak",
                                   # "container_missing", "not_running"
        }
    """
    log.debug("check_mule_vpn: mule=%s", name_or_id)
    try:
        mule = get_mule(client, name_or_id)
    except RuntimeError as exc:
        return {"name": name_or_id, "healthy": False, "ip": None, "reason": str(exc),
                "kind": "container_missing"}

    if mule.status != "running":
        return {
            "name": mule.name,
            "healthy": False,
            "ip": None,
            "reason": f"container not running (status={mule.status})",
            "kind": "not_running",
        }

    vpn_iface = "tun0" if mule.vpn_type == "openvpn" else "wg0"
    ip, country, reason = _probe_vpn_ip(mule.container, vpn_iface)

    if not ip:
        return {"name": mule.name, "healthy": False, "ip": None, "reason": reason,
                "kind": "probe_failed"}

    if _PRIVATE_IP_PATTERN.match(ip):
        return {
            "name": mule.name,
            "healthy": False,
            "ip": ip,
            "reason": f"IP leak — external IP '{ip}' is a private/Docker address",
            "kind": "ip_leak",
        }

    # Real-egress verification: the interface-bound probe above only proves the
    # tunnel *interface* can reach the internet. aria2 egresses via the default
    # route, so probe that too. A default-route exit IP that differs from the
    # tunnel IP means aria2's real traffic is bypassing the VPN — a real-IP leak
    # the interface-bound probe cannot see. A *failed* default-route probe is not
    # treated as a leak (with the mule kill-switch firewall active, a broken
    # default route is dropped, not leaked) to avoid false-positive evacuations.
    route_ip, _route_reason = _probe_default_route_ip(mule.container)
    if route_ip and route_ip != ip:
        log.error(
            "check_mule_vpn: mule=%s REAL-IP LEAK — default-route ip=%s != vpn ip=%s",
            mule.name, route_ip, ip,
        )
        return {
            "name": mule.name,
            "healthy": False,
            "ip": route_ip,
            "reason": (
                f"IP leak — default-route exit IP '{route_ip}' does not match "
                f"VPN IP '{ip}'; aria2 traffic is bypassing the tunnel"
            ),
            "kind": "ip_leak",
        }

    log.info("check_mule_vpn: mule=%s ip=%s country=%s — healthy", mule.name, ip, country or "?")
    return {"name": mule.name, "healthy": True, "ip": ip, "reason": reason, "kind": "healthy"}


def _collect_source_downloads(client: docker.DockerClient, source_name: str) -> list[dict]:
    """Return the active + waiting download list from *source_name*, or [] on error."""
    from cli.aria2_client import Aria2Error  # local import avoids circular dep

    try:
        source = get_mule(client, source_name)
        src_aria2 = aria2_for(source, timeout=5)
        return src_aria2.tell_active() + src_aria2.tell_waiting()
    except (RuntimeError, Aria2Error) as exc:
        log.warning("evacuate_mule: cannot list torrents on source %s — %s", source_name, exc)
        return []


def _migrate_downloads(downloads: list[dict], targets: list, report: dict) -> None:
    """Migrate each download to a healthy target mule (round-robin) and update *report*."""
    import urllib.parse as _up
    from cli.aria2_client import Aria2Error  # local import avoids circular dep

    for idx, dl in enumerate(downloads):
        gid = dl.get("gid", "?")
        bt = dl.get("bittorrent", {})
        name = bt.get("info", {}).get("name") or gid

        magnet = dl.get("magnetUri") or dl.get("infoHash") and (
            "magnet:?xt=urn:btih:" + dl["infoHash"]
            + ("&dn=" + _up.quote(name) if name and name != gid else "")
        )

        if not magnet:
            log.warning("evacuate_mule: gid=%s has no magnet or infoHash — skipping", gid)
            report["skipped"].append({"gid": gid, "name": name, "reason": "no magnet URI or infoHash"})
            continue

        target = targets[idx % len(targets)]
        tgt_aria2 = aria2_for(target, timeout=5)
        try:
            new_gid = tgt_aria2.add_magnet(magnet)
            log.info("evacuate_mule: migrated gid=%s → %s new_gid=%s", gid, target.name, new_gid)
            report["migrated"].append(
                {"gid": gid, "name": name, "target_mule": target.name, "new_gid": new_gid}
            )
        except Aria2Error as exc:
            log.error("evacuate_mule: failed to re-add gid=%s to %s — %s", gid, target.name, exc)
            report["skipped"].append({"gid": gid, "name": name, "reason": str(exc)})


def evacuate_mule(
    client: docker.DockerClient,
    source_name: str,
    kill_after: bool = True,
) -> dict:
    """
    Migrate all active/waiting torrents from *source_name* to healthy mules.

    For each torrent the function:
      1. Reconstructs a magnet URI from ``magnetUri`` (aria2 field) or ``infoHash``.
      2. Re-adds the magnet to a healthy target mule (round-robin).
      3. Optionally kills and removes the source mule.

    Returns a report dict::

        {
          "migrated":  [{"gid", "name", "target_mule", "new_gid"}, ...],
          "skipped":   [{"gid", "name", "reason"}, ...],
          "no_targets": bool,   # True if no healthy mules found
          "killed":    bool,
        }
    """
    log.info("evacuate_mule: starting evacuation source=%s kill_after=%s", log_safe(source_name), kill_after)

    report: dict = {"migrated": [], "skipped": [], "no_targets": False, "killed": False}

    # ── Find healthy target mules ────────────────────────────────────────────
    all_mules = list_mules(client)
    targets = [
        m for m in all_mules
        if m.name != source_name
        and m.status == "running"
        and check_mule_vpn(client, m.name)["healthy"]
    ]

    if not targets:
        log.warning("evacuate_mule: no healthy target mules — cannot migrate from %s", source_name)
        report["no_targets"] = True
    else:
        log.info("evacuate_mule: %d healthy target(s) available: %s",
                 len(targets), [t.name for t in targets])
        downloads = _collect_source_downloads(client, source_name)
        _migrate_downloads(downloads, targets, report)

    # ── Kill the compromised mule ────────────────────────────────────────────
    if kill_after:
        try:
            kill_mule(client, source_name, remove=True)
            report["killed"] = True
            log.info("evacuate_mule: source mule %s killed and removed", source_name)
        except RuntimeError as exc:
            log.error("evacuate_mule: failed to kill source mule %s — %s", source_name, exc)

    log.info(
        "evacuate_mule: done — migrated=%d skipped=%d no_targets=%s killed=%s",
        len(report["migrated"]), len(report["skipped"]),
        report["no_targets"], report["killed"],
    )
    return report


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
