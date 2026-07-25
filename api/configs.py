"""Blueprint: /api/configs — VPN configuration management."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from flask import Blueprint, request, jsonify

from api.crypto import EncryptionUnavailable
from api.database import list_vpn_configs, get_vpn_config, add_vpn_config, delete_vpn_config
from cli.log import get_logger, log_safe
from cli.docker_client import (
    get_docker_client,
    start_mule,
    wait_for_vpn,
    stop_mule,
    list_mules,
)
from api.settings import read_settings
from api.settings_sync import apply_settings_to_mule

log = get_logger(__name__)
configs_bp = Blueprint("configs", __name__, url_prefix="/api/configs")


def _detect_vpn_type(filename: str) -> str:
    """Infer VPN type from file extension."""
    return "openvpn" if Path(filename).suffix.lower() == ".ovpn" else "wireguard"


def _detect_requires_auth(content: bytes) -> bool:
    """Return True if the .ovpn file has a bare 'auth-user-pass' directive.

    A bare directive (no filename argument) means OpenVPN needs interactive
    credentials. 'auth-user-pass /path/to/file' is self-contained and does not.
    """
    for line in content.decode(errors="replace").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith(";"):
            continue
        parts = stripped.split()
        if parts[0].lower() == "auth-user-pass" and len(parts) == 1:
            return True
    return False


def _config_id_to_mule() -> dict[int, str]:
    """Map active config_id → mule name for non-exited mules."""
    try:
        client = get_docker_client()
        mules = list_mules(client)
    except RuntimeError:
        return {}
    mapping: dict[int, str] = {}
    for m in mules:
        if m.config_id is None or m.status == "exited":
            continue
        mapping.setdefault(m.config_id, m.name)
    return mapping


@configs_bp.get("/")
def list_configs():
    log.info("GET /api/configs/")
    configs = list_vpn_configs()
    in_use = _config_id_to_mule()
    for c in configs:
        c["in_use_by_mule"] = in_use.get(c["id"])
    return jsonify(configs)


@configs_bp.post("/")
def upload_config():
    """Upload a VPN configuration file (.conf for WireGuard, .ovpn for OpenVPN).

    Multipart form fields:
      - config_file  (file, required)
      - name         (str, optional — defaults to filename stem)
      - username     (str, optional — OpenVPN credentials)
      - password     (str, optional — OpenVPN credentials)
    """
    log.info("POST /api/configs/")

    if "config_file" not in request.files:
        return jsonify({"error": "config_file is required"}), 400

    file = request.files["config_file"]
    if not file.filename:
        return jsonify({"error": "filename is required"}), 400

    name = request.form.get("name", "").strip()
    if not name:
        name = Path(file.filename).stem

    content = file.read()
    vpn_type = _detect_vpn_type(file.filename)
    requires_auth = _detect_requires_auth(content) if vpn_type == "openvpn" else False

    username = request.form.get("username", "").strip() or None
    password = request.form.get("password", "").strip() or None

    try:
        config_id = add_vpn_config(
            name=name,
            filename=file.filename,
            content=content,
            vpn_type=vpn_type,
            requires_auth=requires_auth,
            ovpn_username=username,
            ovpn_password=password,
        )
    except EncryptionUnavailable as exc:
        # The config body holds private keys, so storing it unencrypted is worse
        # than refusing the upload. Surfaced as 503: the request is valid, the
        # server is misconfigured.
        log.error("POST /api/configs/: refusing upload — %s", exc)
        return jsonify({"error": str(exc)}), 503
    log.info(
        "POST /api/configs/: created id=%d name=%s vpn_type=%s requires_auth=%s",
        config_id, log_safe(name), vpn_type, requires_auth,
    )

    return jsonify({
        "id": config_id,
        "name": name,
        "filename": file.filename,
        "vpn_type": vpn_type,
        "requires_auth": requires_auth,
    }), 201


@configs_bp.delete("/<int:config_id>")
def remove_config(config_id: int):
    log.info("DELETE /api/configs/%d", config_id)
    deleted = delete_vpn_config(config_id)
    if not deleted:
        return jsonify({"error": "Config not found"}), 404
    return jsonify({"ok": True})


class DeployError(RuntimeError):
    """A deploy failure carrying the HTTP status the caller should surface."""

    def __init__(self, message: str, status: int = 500, **extra):
        super().__init__(message)
        self.status = status
        self.extra = extra


def check_deployable(config_id: int) -> dict:
    """Validate that *config_id* can be deployed, returning the config row.

    Raises :class:`DeployError` with the right status when it cannot. Split out
    so the synchronous and asynchronous deploy paths reject the same cases with
    the same messages, and so the async path can fail fast before spawning a
    thread.
    """
    config = get_vpn_config(config_id)
    if not config:
        raise DeployError("Config not found", 404)

    # A config can back at most one active mule at a time.
    in_use = _config_id_to_mule().get(config_id)
    if in_use:
        raise DeployError(
            f"Config already in use by active mule '{in_use}'. "
            "Stop that mule first or deploy from a different config.",
            409,
            in_use_by_mule=in_use,
        )

    if config.get("vpn_type") == "openvpn" and config.get("requires_auth"):
        if not config.get("ovpn_username") or not config.get("ovpn_password"):
            raise DeployError(
                "This OpenVPN config requires credentials. "
                "Delete and re-upload with username and password.",
                400,
            )
    return config


def perform_deploy(config_id: int, config: dict, mule_name: str | None = None,
                   on_started=None) -> dict:
    """Write the config to a temp file, start the mule, and wait for its VPN.

    Shared by the synchronous endpoint and the async deployment job so the two
    cannot drift. *on_started* is invoked with the container name as soon as it
    exists, which lets the async path report a real phase while this blocks.
    Raises :class:`DeployError` on failure; always removes the temp config.
    """
    vpn_type = config.get("vpn_type", "wireguard")
    suffix = ".ovpn" if vpn_type == "openvpn" else ".conf"

    host_root = Path(os.environ.get("SMG_HOST_ROOT", os.getcwd()))
    smg_tmp_dir = host_root / "data" / "tmp"
    smg_tmp_dir.mkdir(parents=True, exist_ok=True)

    tmp = tempfile.NamedTemporaryFile(suffix=suffix, dir=smg_tmp_dir, delete=False)
    try:
        tmp.write(config["content"])
        tmp.close()

        client = get_docker_client()
        settings = read_settings()
        downloads_dir = Path(settings.get("download_dir", str(host_root / "downloads")))
        downloads_dir.mkdir(parents=True, exist_ok=True)

        try:
            mule = start_mule(
                client,
                vpn_config_path=tmp.name,
                name=mule_name,
                downloads_dir=downloads_dir,
                vpn_type=vpn_type,
                ovpn_username=config.get("ovpn_username"),
                ovpn_password=config.get("ovpn_password"),
                config_id=config_id,
            )
        except (FileNotFoundError, RuntimeError) as exc:
            raise DeployError(str(exc), 500) from exc

        log.info("deploy config=%d: container started name=%s vpn_type=%s",
                 config_id, mule.name, vpn_type)
        if on_started:
            on_started(mule.name)

        try:
            ip_info = wait_for_vpn(client, mule.name, timeout=90)
            log.info("deploy config=%d: VPN up ip=%s", config_id, ip_info.get("ip"))
            apply_settings_to_mule(mule.name, settings)
        except RuntimeError as exc:
            log.error("deploy config=%d: VPN failed — %s", config_id, exc)
            try:
                stop_mule(client, mule.name, remove=True)
            except RuntimeError:
                pass
            raise DeployError(str(exc), 502) from exc

        return {
            "name": mule.name,
            "id": mule.id,
            "status": mule.status,
            "rpc_port": mule.rpc_port,
            "vpn_config": mule.vpn_config,
            "vpn_type": mule.vpn_type,
            "ip_info": ip_info,
        }
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


@configs_bp.post("/<int:config_id>/deploy")
def deploy_mule(config_id: int):
    """Deploy a new mule using a stored VPN config, blocking until it is up.

    Kept synchronous for the desktop client and any existing scripts. The web UI
    uses ``POST /api/deployments/`` instead, which reports real progress rather
    than blocking a request thread for up to 90 seconds.

    JSON body (optional):
      - name (str) — mule name override
    """
    log.info("POST /api/configs/%d/deploy", config_id)
    data = request.get_json(silent=True) or {}
    try:
        config = check_deployable(config_id)
        result = perform_deploy(config_id, config, data.get("name") or None)
    except DeployError as exc:
        log.error("POST /api/configs/%d/deploy: %s", config_id, exc)
        return jsonify({"error": str(exc), **exc.extra}), exc.status
    return jsonify(result), 201
