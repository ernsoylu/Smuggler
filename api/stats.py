"""Blueprint: /api/stats — global download/upload totals."""

from __future__ import annotations

import shutil

from flask import Blueprint, jsonify

from cli.log import get_logger
from cli.docker_client import get_docker_client, list_mules
from cli.aria2_client import Aria2Client, Aria2Error
from api.database import get_setting

log = get_logger(__name__)
stats_bp = Blueprint("stats", __name__, url_prefix="/api/stats")


@stats_bp.get("/")
def global_stats():
    log.debug("GET /api/stats/")
    docker = get_docker_client()
    mules = [w for w in list_mules(docker) if w.status == "running"]
    log.debug("GET /api/stats/: aggregating %d running mules", len(mules))

    total_down = 0
    total_up = 0
    num_active = 0
    num_waiting = 0
    num_stopped = 0

    for w in mules:
        aria2 = Aria2Client(host="localhost", port=w.rpc_port, token=w.rpc_token)
        try:
            gs = aria2.get_global_stat()
            total_down += int(gs.get("downloadSpeed", 0))
            total_up += int(gs.get("uploadSpeed", 0))
            num_active += int(gs.get("numActive", 0))
            num_waiting += int(gs.get("numWaiting", 0))
            num_stopped += int(gs.get("numStopped", 0))
        except Aria2Error as exc:
            log.warning("GET /api/stats/: skipping mule=%s — %s", w.name, exc)

    # Disk space for configured download directory
    disk_free: int | None = None
    disk_total: int | None = None
    try:
        download_dir = get_setting("download_dir")
        usage = shutil.disk_usage(download_dir)
        disk_free = usage.free
        disk_total = usage.total
    except Exception as exc:
        log.debug("GET /api/stats/: disk_usage unavailable — %s", exc)

    result = {
        "download_speed": total_down,
        "upload_speed": total_up,
        "num_active": num_active,
        "num_waiting": num_waiting,
        "num_stopped": num_stopped,
        "num_mules": len(mules),
        "disk_free": disk_free,
        "disk_total": disk_total,
    }
    log.debug("GET /api/stats/: %s", result)
    return jsonify(result)
