"""Blueprint: /api/workers"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from flask import Blueprint, request, jsonify

from cli.log import get_logger
from cli.docker_client import (
    get_docker_client,
    start_worker,
    list_workers,
    get_worker,
    stop_worker,
    kill_worker,
    exec_in_worker,
    wait_for_vpn,
    WorkerInfo,
)

log = get_logger(__name__)
workers_bp = Blueprint("workers", __name__, url_prefix="/api/workers")


def _serialize(w: WorkerInfo, ip_info: dict | None = None) -> dict:
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


def _fetch_ip_info(client, worker_name: str) -> dict | None:
    """Fetch VPN IP info for a running worker; returns None on any failure."""
    import json as _json
    try:
        raw = exec_in_worker(client, worker_name,
                             "curl -sf --max-time 8 https://ipinfo.io/json")
        info = _json.loads(raw)
        info.pop("readme", None)
        return info
    except RuntimeError as exc:
        # Non-zero exit (e.g. curl timeout code 28, or SIGKILL code 137 on
        # container restart) — expected during startup, log at debug level.
        log.debug("_fetch_ip_info: worker=%s — %s", worker_name, exc)
        return None
    except Exception as exc:
        log.warning("_fetch_ip_info: unexpected error worker=%s — %s", worker_name, exc)
        return None


# ─── GET /api/workers ────────────────────────────────────────────────────────

@workers_bp.get("/")
def list_all():
    log.info("GET /api/workers/")
    client = get_docker_client()
    workers = list_workers(client)
    log.info("GET /api/workers/: returning %d workers", len(workers))

    result = []
    for w in workers:
        ip_info = _fetch_ip_info(client, w.name) if w.status == "running" else None
        result.append(_serialize(w, ip_info))
    return jsonify(result)


# ─── POST /api/workers ───────────────────────────────────────────────────────

@workers_bp.post("/")
def create():
    """
    Start a new worker.

    Accepts multipart/form-data:
      - vpn_config (file, required) — WireGuard .conf file
      - name       (str,  optional) — worker name
    """
    log.info("POST /api/workers/")

    if "vpn_config" not in request.files:
        log.warning("POST /api/workers/: missing vpn_config field")
        return jsonify({"error": "vpn_config file is required"}), 400

    file = request.files["vpn_config"]
    name = request.form.get("name") or None
    log.info("POST /api/workers/: filename=%s name=%s", file.filename, name)

    suffix = Path(file.filename or "wg.conf").suffix or ".conf"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.close()  # close before writing so save() can take the path cleanly
    try:
        file.save(tmp.name)
        log.debug("POST /api/workers/: saved vpn config to tmp=%s", tmp.name)
        client = get_docker_client()

        # Load download directory from settings, fall back to ./downloads
        from api.settings import read_settings
        settings = read_settings()
        downloads_dir = Path(settings.get("download_dir", str(Path(os.getcwd()) / "downloads")))
        downloads_dir.mkdir(parents=True, exist_ok=True)
        log.info("POST /api/workers/: using downloads_dir=%s", downloads_dir)

        worker = start_worker(client, vpn_config_path=tmp.name, name=name,
                              downloads_dir=downloads_dir)
        log.info("POST /api/workers/: container started name=%s", worker.name)

        # Block until VPN is confirmed (up to 90 s)
        try:
            ip_info = wait_for_vpn(client, worker.name, timeout=90)
            log.info(
                "POST /api/workers/: VPN confirmed name=%s ip=%s",
                worker.name, ip_info.get("ip"),
            )
        except RuntimeError as exc:
            log.error(
                "POST /api/workers/: VPN failed for name=%s — %s",
                worker.name, exc,
            )
            # Best-effort cleanup — ignore errors if container already exited
            try:
                stop_worker(client, worker.name, remove=True)
            except RuntimeError as cleanup_exc:
                log.warning(
                    "POST /api/workers/: cleanup error for name=%s — %s",
                    worker.name, cleanup_exc,
                )
            return jsonify({"error": str(exc)}), 502

        return jsonify({**_serialize(worker), "ip_info": ip_info}), 201

    except FileNotFoundError as exc:
        log.error("POST /api/workers/: file not found — %s", exc)
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        log.error("POST /api/workers/: runtime error — %s", exc)
        return jsonify({"error": str(exc)}), 500
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


# ─── GET /api/workers/<name> ─────────────────────────────────────────────────

@workers_bp.get("/<worker_name>")
def get_one(worker_name: str):
    log.info("GET /api/workers/%s", worker_name)
    client = get_docker_client()
    try:
        w = get_worker(client, worker_name)
    except RuntimeError as exc:
        log.warning("GET /api/workers/%s: not found — %s", worker_name, exc)
        return jsonify({"error": str(exc)}), 404
    ip_info = _fetch_ip_info(client, w.name) if w.status == "running" else None
    return jsonify(_serialize(w, ip_info))


# ─── DELETE /api/workers/<name> ──────────────────────────────────────────────

@workers_bp.delete("/<worker_name>")
def remove(worker_name: str):
    keep = request.args.get("keep", "false").lower() == "true"
    log.info("DELETE /api/workers/%s keep=%s", worker_name, keep)
    client = get_docker_client()
    try:
        stop_worker(client, worker_name, remove=not keep)
    except RuntimeError as exc:
        log.warning("DELETE /api/workers/%s: error — %s", worker_name, exc)
        return jsonify({"error": str(exc)}), 404
    log.info("DELETE /api/workers/%s: done", worker_name)
    return jsonify({"ok": True})


# ─── POST /api/workers/<name>/kill ───────────────────────────────────────────

@workers_bp.post("/<worker_name>/kill")
def force_kill(worker_name: str):
    keep = request.args.get("keep", "false").lower() == "true"
    log.info("POST /api/workers/%s/kill keep=%s", worker_name, keep)
    client = get_docker_client()
    try:
        kill_worker(client, worker_name, remove=not keep)
    except RuntimeError as exc:
        log.warning("POST /api/workers/%s/kill: error — %s", worker_name, exc)
        return jsonify({"error": str(exc)}), 404
    log.info("POST /api/workers/%s/kill: done", worker_name)
    return jsonify({"ok": True})


# ─── GET /api/workers/<name>/ip ──────────────────────────────────────────────

@workers_bp.get("/<worker_name>/ip")
def get_ip(worker_name: str):
    log.info("GET /api/workers/%s/ip", worker_name)
    client = get_docker_client()
    try:
        raw = exec_in_worker(client, worker_name,
                             "curl -sf --max-time 8 https://ipinfo.io/json")
    except RuntimeError as exc:
        log.error("GET /api/workers/%s/ip: exec error — %s", worker_name, exc)
        return jsonify({"error": str(exc)}), 400

    try:
        info = json.loads(raw)
        info.pop("readme", None)
        log.info("GET /api/workers/%s/ip: ip=%s", worker_name, info.get("ip"))
        return jsonify(info)
    except (json.JSONDecodeError, ValueError):
        log.error("GET /api/workers/%s/ip: unexpected response — %r", worker_name, raw)
        return jsonify({"error": "Unexpected response from ipinfo.io", "raw": raw}), 502
