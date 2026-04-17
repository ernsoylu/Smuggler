"""Blueprint: /api/configs — VPN configuration management."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from flask import Blueprint, request, jsonify

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

    config_id = add_vpn_config(
        name=name,
        filename=file.filename,
        content=content,
        vpn_type=vpn_type,
        requires_auth=requires_auth,
        ovpn_username=username,
        ovpn_password=password,
    )
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


@configs_bp.post("/<int:config_id>/deploy")
def deploy_mule(config_id: int):
    """Deploy a new mule using a stored VPN config.

    JSON body (optional):
      - name (str) — mule name override
    """
    log.info("POST /api/configs/%d/deploy", config_id)

    config = get_vpn_config(config_id)
    if not config:
        return jsonify({"error": "Config not found"}), 404

    # Guard: a config can back at most one active mule at a time.
    in_use = _config_id_to_mule().get(config_id)
    if in_use:
        return jsonify({
            "error": f"Config already in use by active mule '{in_use}'. "
                     "Stop that mule first or deploy from a different config.",
            "in_use_by_mule": in_use,
        }), 409

    # Guard: OpenVPN configs that require credentials must have them stored
    if config.get("vpn_type") == "openvpn" and config.get("requires_auth"):
        if not config.get("ovpn_username") or not config.get("ovpn_password"):
            return jsonify({
                "error": "This OpenVPN config requires credentials. "
                         "Delete and re-upload with username and password."
            }), 400

    data = request.get_json(silent=True) or {}
    mule_name = data.get("name") or None

    vpn_type = config.get("vpn_type", "wireguard")
    suffix = ".ovpn" if vpn_type == "openvpn" else ".conf"

    smg_tmp_dir = Path(os.environ.get("SMG_HOST_ROOT", os.getcwd())) / "data" / "tmp"
    smg_tmp_dir.mkdir(parents=True, exist_ok=True)

    tmp = tempfile.NamedTemporaryFile(suffix=suffix, dir=smg_tmp_dir, delete=False)
    try:
        tmp.write(config["content"])
        tmp.close()

        client = get_docker_client()
        settings = read_settings()
        downloads_dir = Path(settings.get("download_dir", str(Path(os.environ.get("SMG_HOST_ROOT", os.getcwd())) / "downloads")))
        downloads_dir.mkdir(parents=True, exist_ok=True)

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
        log.info(
            "POST /api/configs/%d/deploy: container started name=%s vpn_type=%s",
            config_id, mule.name, vpn_type,
        )

        try:
            ip_info = wait_for_vpn(client, mule.name, timeout=90)
            log.info("POST /api/configs/%d/deploy: VPN up ip=%s", config_id, ip_info.get("ip"))
            apply_settings_to_mule(mule.name, settings)
        except RuntimeError as exc:
            log.error("POST /api/configs/%d/deploy: VPN failed — %s", config_id, exc)
            try:
                stop_mule(client, mule.name, remove=True)
            except RuntimeError:
                pass
            return jsonify({"error": str(exc)}), 502

        result = {
            "name": mule.name,
            "id": mule.id,
            "status": mule.status,
            "rpc_port": mule.rpc_port,
            "vpn_config": mule.vpn_config,
            "vpn_type": mule.vpn_type,
            "ip_info": ip_info,
        }
        return jsonify(result), 201

    except (FileNotFoundError, RuntimeError) as exc:
        log.error("POST /api/configs/%d/deploy: error — %s", config_id, exc)
        return jsonify({"error": str(exc)}), 500
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
