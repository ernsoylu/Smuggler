"""Blueprint: /api/mules"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from flask import Blueprint, request, jsonify

from cli.log import get_logger
from cli.docker_client import (
    get_docker_client,
    start_mule,
    list_mules,
    get_mule,
    stop_mule,
    kill_mule,
    exec_in_mule,
    wait_for_vpn,
    check_mule_vpn,
    evacuate_mule,
    MuleInfo,
)

log = get_logger(__name__)
mules_bp = Blueprint("mules", __name__, url_prefix="/api/mules")


def _serialize(w: MuleInfo, ip_info: dict | None = None) -> dict:
    result: dict = {
        "name": w.name,
        "id": w.id,
        "status": w.status,
        "rpc_port": w.rpc_port,
        "vpn_config": w.vpn_config,
    }
    if ip_info:
        result["ip_info"] = {
            "ip": ip_info.get("ip", ""),
            "city": ip_info.get("city", ""),
            "region": ip_info.get("region", ""),
            "country": ip_info.get("country", ""),
            "org": ip_info.get("org", ""),
        }
    return result


def _fetch_ip_info(client, mule_name: str) -> dict | None:
    """Fetch VPN IP info for a running mule; returns None on any failure."""
    import json as _json
    try:
        raw = exec_in_mule(client, mule_name,
                           "curl -sf --max-time 8 https://ipinfo.io/json")
        info = _json.loads(raw)
        info.pop("readme", None)
        return info
    except RuntimeError as exc:
        # code 28 = curl timeout, code 137 = SIGKILL during container restart
        log.debug("_fetch_ip_info: mule=%s — %s", mule_name, exc)
        return None
    except Exception as exc:
        log.warning("_fetch_ip_info: unexpected error mule=%s — %s", mule_name, exc)
        return None


# ─── GET /api/mules ──────────────────────────────────────────────────────────
@mules_bp.get("/")
def list_all():
    log.info("GET /api/mules/")
    client = get_docker_client()
    mules = list_mules(client)
    log.info("GET /api/mules/: returning %d mules", len(mules))

    result = []
    for w in mules:
        ip_info = _fetch_ip_info(client, w.name) if w.status == "running" else None
        result.append(_serialize(w, ip_info))
    return jsonify(result)


# ─── POST /api/mules ─────────────────────────────────────────────────────────

@mules_bp.post("/")
def create():
    """
    Start a new mule.

    Accepts multipart/form-data:
      - vpn_config (file, required) — WireGuard .conf file
      - name       (str,  optional) — worker name
    """
    log.info("POST /api/mules/")

    if "vpn_config" not in request.files:
        log.warning("POST /api/mules/: missing vpn_config field")
        return jsonify({"error": "vpn_config file is required"}), 400

    file = request.files["vpn_config"]
    name = request.form.get("name") or None
    log.info("POST /api/mules/: filename=%s name=%s", file.filename, name)

    suffix = Path(file.filename or "wg.conf").suffix or ".conf"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.close()  # close before writing so save() can take the path cleanly
    try:
        file.save(tmp.name)
        log.debug("POST /api/mules/: saved vpn config to tmp=%s", tmp.name)
        client = get_docker_client()

        # Load download directory from settings, fall back to ./downloads
        from api.settings import read_settings
        settings = read_settings()
        downloads_dir = Path(settings.get("download_dir", str(Path(os.getcwd()) / "downloads")))
        downloads_dir.mkdir(parents=True, exist_ok=True)
        log.info("POST /api/mules/: using downloads_dir=%s", downloads_dir)

        mule = start_mule(client, vpn_config_path=tmp.name, name=name,
                              downloads_dir=downloads_dir)
        log.info("POST /api/mules/: container started name=%s", mule.name)

        # Block until VPN is confirmed
        try:
            ip_info = wait_for_vpn(client, mule.name, timeout=90)
            log.info(
                "POST /api/mules/: VPN confirmed name=%s ip=%s",
                mule.name, ip_info.get("ip"),
            )
        except RuntimeError as exc:
            log.error(
                "POST /api/mules/: VPN failed for name=%s — %s",
                mule.name, exc,
            )
            # Best-effort cleanup
            try:
                stop_mule(client, mule.name, remove=True)
            except RuntimeError as cleanup_exc:
                log.warning(
                    "POST /api/mules/: cleanup error for name=%s — %s",
                    mule.name, cleanup_exc,
                )
            return jsonify({"error": str(exc)}), 502

        return jsonify({**_serialize(mule), "ip_info": ip_info}), 201

    except FileNotFoundError as exc:
        log.error("POST /api/mules/: file not found — %s", exc)
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        log.error("POST /api/mules/: runtime error — %s", exc)
        return jsonify({"error": str(exc)}), 500
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


# ─── GET /api/mules/<name> ───────────────────────────────────────────────────

@mules_bp.get("/<mule_name>")
def get_one(mule_name: str):
    log.info("GET /api/mules/%s", mule_name)
    client = get_docker_client()
    try:
        w = get_mule(client, mule_name)
    except RuntimeError as exc:
        log.warning("GET /api/mules/%s: not found — %s", mule_name, exc)
        return jsonify({"error": str(exc)}), 404
    ip_info = _fetch_ip_info(client, w.name) if w.status == "running" else None
    return jsonify(_serialize(w, ip_info))


# ─── DELETE /api/mules/<name> ────────────────────────────────────────────────

@mules_bp.delete("/<mule_name>")
def remove(mule_name: str):
    keep = request.args.get("keep", "false").lower() == "true"
    log.info("DELETE /api/mules/%s keep=%s", mule_name, keep)
    client = get_docker_client()
    try:
        stop_mule(client, mule_name, remove=not keep)
    except RuntimeError as exc:
        log.warning("DELETE /api/mules/%s: error — %s", mule_name, exc)
        return jsonify({"error": str(exc)}), 404
    log.info("DELETE /api/mules/%s: done", mule_name)
    return jsonify({"ok": True})


# ─── POST /api/mules/<name>/kill ─────────────────────────────────────────────

@mules_bp.post("/<mule_name>/kill")
def force_kill(mule_name: str):
    keep = request.args.get("keep", "false").lower() == "true"
    log.info("POST /api/mules/%s/kill keep=%s", mule_name, keep)
    client = get_docker_client()
    try:
        kill_mule(client, mule_name, remove=not keep)
    except RuntimeError as exc:
        log.warning("POST /api/mules/%s/kill: error — %s", mule_name, exc)
        return jsonify({"error": str(exc)}), 404
    log.info("POST /api/mules/%s/kill: done", mule_name)
    return jsonify({"ok": True})


# ─── GET /api/mules/<name>/health ───────────────────────────────────────────

@mules_bp.get("/<mule_name>/health")
def vpn_health(mule_name: str):
    """Return live VPN health for a mule (runs check inside container)."""
    log.info("GET /api/mules/%s/health", mule_name)
    client = get_docker_client()
    result = check_mule_vpn(client, mule_name)
    status_code = 200 if result["healthy"] else 503
    return jsonify(result), status_code


# ─── POST /api/mules/<name>/evacuate ────────────────────────────────────────

@mules_bp.post("/<mule_name>/evacuate")
def evacuate(mule_name: str):
    """
    Migrate all active/waiting torrents from *mule_name* to healthy mules,
    then kill and remove the evacuated mule.

    Query params:
      ?kill=false  — migrate but do not remove the source mule
    """
    kill_after = request.args.get("kill", "true").lower() != "false"
    log.info("POST /api/mules/%s/evacuate kill_after=%s", mule_name, kill_after)
    client = get_docker_client()
    try:
        report = evacuate_mule(client, mule_name, kill_after=kill_after)
    except RuntimeError as exc:
        log.error("POST /api/mules/%s/evacuate: error — %s", mule_name, exc)
        return jsonify({"error": str(exc)}), 500
    return jsonify(report)


# ─── GET /api/mules/<name>/ip ────────────────────────────────────────────────

@mules_bp.get("/<mule_name>/ip")
def get_ip(mule_name: str):
    log.info("GET /api/mules/%s/ip", mule_name)
    client = get_docker_client()
    try:
        raw = exec_in_mule(client, mule_name,
                             "curl -sf --max-time 8 https://ipinfo.io/json")
    except RuntimeError as exc:
        log.error("GET /api/mules/%s/ip: exec error — %s", mule_name, exc)
        return jsonify({"error": str(exc)}), 400

    try:
        info = json.loads(raw)
        info.pop("readme", None)
        log.info("GET /api/mules/%s/ip: ip=%s", mule_name, info.get("ip"))
        return jsonify(info)
    except (json.JSONDecodeError, ValueError):
        log.error("GET /api/mules/%s/ip: unexpected response — %r", mule_name, raw)
        return jsonify({"error": "Unexpected response from ipinfo.io", "raw": raw}), 502
