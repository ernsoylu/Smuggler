"""Blueprint: /api/configs — VPN configuration management."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from flask import Blueprint, request, jsonify

from api.database import list_vpn_configs, get_vpn_config, add_vpn_config, delete_vpn_config
from cli.log import get_logger
from cli.docker_client import (
    get_docker_client,
    start_mule,
    wait_for_vpn,
    stop_mule,
)
from api.settings import read_settings
from api.settings_sync import apply_settings_to_mule

log = get_logger(__name__)
configs_bp = Blueprint("configs", __name__, url_prefix="/api/configs")


@configs_bp.get("/")
def list_configs():
    log.info("GET /api/configs/")
    configs = list_vpn_configs()
    return jsonify(configs)


@configs_bp.post("/")
def upload_config():
    """Upload a VPN configuration file.

    Multipart form:
      - config_file (file, required)
      - name (str, optional — defaults to filename sans extension)
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
    config_id = add_vpn_config(name=name, filename=file.filename, content=content)
    log.info("POST /api/configs/: created id=%d name=%s", config_id, name)

    return jsonify({"id": config_id, "name": name, "filename": file.filename}), 201


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
      - name (str) — mule name
    """
    log.info("POST /api/configs/%d/deploy", config_id)

    config = get_vpn_config(config_id)
    if not config:
        return jsonify({"error": "Config not found"}), 404

    data = request.get_json(silent=True) or {}
    mule_name = data.get("name") or None

    # Write config content to a temp file for docker mount
    tmp = tempfile.NamedTemporaryFile(suffix=".conf", delete=False)
    try:
        tmp.write(config["content"])
        tmp.close()

        client = get_docker_client()
        settings = read_settings()
        downloads_dir = Path(settings.get("download_dir", str(Path(os.getcwd()) / "downloads")))
        downloads_dir.mkdir(parents=True, exist_ok=True)

        mule = start_mule(client, vpn_config_path=tmp.name, name=mule_name,
                               downloads_dir=downloads_dir)
        log.info("POST /api/configs/%d/deploy: container started name=%s", config_id, mule.name)

        try:
            ip_info = wait_for_vpn(client, mule.name, timeout=90)
            log.info("POST /api/configs/%d/deploy: VPN up ip=%s", config_id, ip_info.get("ip"))
            
            # Apply current global settings to the new Mule
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
