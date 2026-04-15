"""Blueprint: /api/torrents"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from flask import Blueprint, request, jsonify

from cli.log import get_logger
from cli.docker_client import get_docker_client, get_mule, list_mules
from cli.aria2_client import Aria2Client, Aria2Error

log = get_logger(__name__)
torrents_bp = Blueprint("torrents", __name__, url_prefix="/api/torrents")


def _aria2_for(mule_name: str) -> Aria2Client:
    client = get_docker_client()
    w = get_mule(client, mule_name)
    if w.status != "running":
        raise RuntimeError(f"Mule '{mule_name}' is not running (status={w.status})")
    log.debug("_aria2_for: mule=%s port=%d", mule_name, w.rpc_port)
    return Aria2Client(host="localhost", port=w.rpc_port, token=w.rpc_token)


def _serialize_download(dl: dict, mule_name: str) -> dict:
    completed = int(dl.get("completedLength", 0))
    total = int(dl.get("totalLength", 0))
    uploaded = int(dl.get("uploadLength", 0))
    progress = round(completed / total * 100, 1) if total > 0 else 0.0
    dl_speed = int(dl.get("downloadSpeed", 0))
    bt = dl.get("bittorrent", {})
    name = (
        bt.get("info", {}).get("name")
        or (dl.get("files") or [{}])[0].get("path", "")
    )

    # ETA calculation (seconds remaining)
    eta = -1
    remaining = total - completed
    if dl_speed > 0 and remaining > 0:
        eta = int(remaining / dl_speed)

    # Ratio
    ratio = round(uploaded / completed, 3) if completed > 0 else 0.0

    # Tracker — first announce URL
    announce_list = bt.get("announceList", [])
    tracker = ""
    if announce_list and announce_list[0]:
        tracker = announce_list[0][0] if isinstance(announce_list[0], list) else str(announce_list[0])
    
    files = []
    for f in dl.get("files", []):
        f_path = f.get("path", "")
        # Remove base directory prefix if it exists to make names cleaner
        file_name = Path(f_path).name if f_path else "—"
        f_total = int(f.get("length", 0))
        f_comp = int(f.get("completedLength", 0))
        
        files.append({
            "index": int(f.get("index", 1)),
            "path": f_path,
            "name": file_name,
            "total_length": f_total,
            "completed_length": f_comp,
            "progress": round(f_comp / f_total * 100, 1) if f_total > 0 else 0.0,
            "selected": f.get("selected", "true") == "true"
        })

    return {
        "gid": dl.get("gid", ""),
        "mule": mule_name,
        "name": Path(name).name if name else "—",
        "status": dl.get("status", ""),
        "completed_length": completed,
        "total_length": total,
        "uploaded_length": uploaded,
        "download_speed": dl_speed,
        "upload_speed": int(dl.get("uploadSpeed", 0)),
        "progress": progress,
        "num_seeders": int(dl.get("numSeeders", 0)),
        "connections": int(dl.get("connections", 0)),
        "info_hash": dl.get("infoHash", ""),
        "is_seed": dl.get("seeder", "false") == "true",
        "save_path": dl.get("dir", ""),
        "piece_length": int(dl.get("pieceLength", 0)),
        "num_pieces": int(dl.get("numPieces", 0)),
        "eta": eta,
        "ratio": ratio,
        "tracker": tracker,
        "comment": bt.get("comment", ""),
        "creation_date": int(bt.get("creationDate", 0)),
        "mode": bt.get("mode", ""),
        "error_code": dl.get("errorCode", ""),
        "error_message": dl.get("errorMessage", ""),
        "files": files,
        "is_metadata": dl.get("followedBy") is not None or "[METADATA]" in str(name)
    }


def _all_downloads(aria2: Aria2Client, mule_name: str) -> list[dict]:
    downloads = (
        aria2.tell_active()
        + aria2.tell_waiting()
        + aria2.tell_stopped()
    )
    log.debug("_all_downloads: mule=%s total=%d", mule_name, len(downloads))
    serialized = [_serialize_download(d, mule_name) for d in downloads]
    # Filter out completed metadata items
    return [d for d in serialized if not (d["is_metadata"] and d["status"] == "complete")]


# ─── GET /api/torrents ───────────────────────────────────────────────────────

@torrents_bp.get("/")
def list_all():
    log.info("GET /api/torrents/")
    docker = get_docker_client()
    mules = [w for w in list_mules(docker) if w.status == "running"]
    log.debug("GET /api/torrents/: querying %d running mules", len(mules))
    result = []
    for w in mules:
        aria2 = Aria2Client(host="localhost", port=w.rpc_port, token=w.rpc_token)
        try:
            items = _all_downloads(aria2, w.name)
            result.extend(items)
        except Aria2Error as exc:
            log.warning("GET /api/torrents/: skipping mule=%s — %s", w.name, exc)
    log.info("GET /api/torrents/: returning %d torrents", len(result))
    return jsonify(result)


# ─── GET /api/torrents/<mule> ──────────────────────────────────────────────

@torrents_bp.get("/<mule_name>")
def list_for_mule(mule_name: str):
    log.info("GET /api/torrents/%s", mule_name)
    try:
        aria2 = _aria2_for(mule_name)
    except RuntimeError as exc:
        log.warning("GET /api/torrents/%s: mule error — %s", mule_name, exc)
        return jsonify({"error": str(exc)}), 404
    try:
        result = _all_downloads(aria2, mule_name)
        log.info("GET /api/torrents/%s: returning %d torrents", mule_name, len(result))
        return jsonify(result)
    except Aria2Error as exc:
        log.error("GET /api/torrents/%s: aria2 error — %s", mule_name, exc)
        return jsonify({"error": str(exc)}), 502


# ─── POST /api/torrents/<mule> ─────────────────────────────────────────────

@torrents_bp.post("/<mule_name>")
def add(mule_name: str):
    """
    Add a torrent to a mule.

    JSON body:    { "magnet": "magnet:?xt=..." }
    Multipart:    torrent_file (file field)
    """
    log.info("POST /api/torrents/%s content_type=%s", mule_name, request.content_type)
    try:
        aria2 = _aria2_for(mule_name)
    except RuntimeError as exc:
        log.warning("POST /api/torrents/%s: mule error — %s", mule_name, exc)
        return jsonify({"error": str(exc)}), 404

    # ── magnet via JSON ───────────────────────────────────────────────────────
    if request.is_json:
        data = request.get_json(silent=True) or {}
        magnet = data.get("magnet", "").strip()
        if not magnet:
            log.warning("POST /api/torrents/%s: missing magnet field", mule_name)
            return jsonify({"error": "magnet URI is required in JSON body"}), 400

        # Parse magnet URI to extract display name (dn=) for per-torrent subdir
        import urllib.parse as _up
        options: dict = {}
        try:
            qs = _up.parse_qs(_up.urlparse(magnet).query)
            dn_vals = qs.get("dn", [])
            dn = dn_vals[0].strip() if dn_vals else ""
        except Exception:
            dn = ""
        if dn:
            safe_name = dn.replace("/", "_")
            options["dir"] = f"/downloads/{safe_name}"
            log.info("POST /api/torrents/%s: magnet dir=%s", mule_name, options["dir"])

        log.info("POST /api/torrents/%s: adding magnet uri=%s", mule_name, magnet[:80])
        try:
            gid = aria2.add_magnet(magnet, options=options or None)
            log.info("POST /api/torrents/%s: magnet added gid=%s", mule_name, gid)
            return jsonify({"gid": gid}), 201
        except Aria2Error as exc:
            log.error("POST /api/torrents/%s: aria2 error adding magnet — %s", mule_name, exc)
            return jsonify({"error": str(exc)}), 502

    # ── .torrent file upload ──────────────────────────────────────────────────
    if "torrent_file" in request.files:
        file = request.files["torrent_file"]
        log.info("POST /api/torrents/%s: adding torrent file=%s", mule_name, file.filename)
        tmp = tempfile.NamedTemporaryFile(suffix=".torrent", delete=False)
        tmp.close()  # close handle so file.save() can write to the path cleanly
        try:
            file.save(tmp.name)
            log.debug(
                "POST /api/torrents/%s: saved torrent file to tmp=%s size=%d",
                mule_name, tmp.name, Path(tmp.name).stat().st_size,
            )

            # Derive folder name from the uploaded filename
            options = {}
            if file.filename:
                base_name = Path(file.filename).stem.strip().replace("/", "_")
                if base_name:
                    options["dir"] = f"/downloads/{base_name}"
                    log.info("POST /api/torrents/%s: torrent file dir=%s", mule_name, options["dir"])

            gid = aria2.add_torrent_file(tmp.name, options=options or None)
            log.info("POST /api/torrents/%s: torrent file added gid=%s", mule_name, gid)
            return jsonify({"gid": gid}), 201
        except Aria2Error as exc:
            log.error(
                "POST /api/torrents/%s: aria2 error adding torrent file — %s",
                mule_name, exc,
            )
            return jsonify({"error": str(exc)}), 502
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

    log.warning("POST /api/torrents/%s: no magnet or torrent_file provided", mule_name)
    return jsonify({"error": "Provide a JSON body with 'magnet' or a 'torrent_file' upload"}), 400


# ─── DELETE /api/torrents/<mule>/<gid> ─────────────────────────────────────

@torrents_bp.delete("/<mule_name>/<gid>")
def remove(mule_name: str, gid: str):
    log.info("DELETE /api/torrents/%s/%s", mule_name, gid)
    try:
        aria2 = _aria2_for(mule_name)
        aria2.remove(gid)
        log.info("DELETE /api/torrents/%s/%s: removed", mule_name, gid)
        return jsonify({"ok": True})
    except RuntimeError as exc:
        log.warning("DELETE /api/torrents/%s/%s: mule error — %s", mule_name, gid, exc)
        return jsonify({"error": str(exc)}), 404
    except Aria2Error as exc:
        log.error("DELETE /api/torrents/%s/%s: aria2 error — %s", mule_name, gid, exc)
        return jsonify({"error": str(exc)}), 502


# ─── POST /api/torrents/<mule>/<gid>/pause ─────────────────────────────────

@torrents_bp.post("/<mule_name>/<gid>/pause")
def pause(mule_name: str, gid: str):
    log.info("POST /api/torrents/%s/%s/pause", mule_name, gid)
    try:
        aria2 = _aria2_for(mule_name)
        aria2.pause(gid)
        log.info("POST /api/torrents/%s/%s/pause: done", mule_name, gid)
        return jsonify({"ok": True})
    except RuntimeError as exc:
        log.warning("POST /api/torrents/%s/%s/pause: mule error — %s", mule_name, gid, exc)
        return jsonify({"error": str(exc)}), 404
    except Aria2Error as exc:
        log.error("POST /api/torrents/%s/%s/pause: aria2 error — %s", mule_name, gid, exc)
        return jsonify({"error": str(exc)}), 502


# ─── POST /api/torrents/<mule>/<gid>/resume ────────────────────────────────

@torrents_bp.post("/<mule_name>/<gid>/resume")
def resume(mule_name: str, gid: str):
    log.info("POST /api/torrents/%s/%s/resume", mule_name, gid)
    try:
        aria2 = _aria2_for(mule_name)
        aria2.resume(gid)
        log.info("POST /api/torrents/%s/%s/resume: done", mule_name, gid)
        return jsonify({"ok": True})
    except RuntimeError as exc:
        log.warning("POST /api/torrents/%s/%s/resume: mule error — %s", mule_name, gid, exc)
        return jsonify({"error": str(exc)}), 404
    except Aria2Error as exc:
        log.error("POST /api/torrents/%s/%s/resume: aria2 error — %s", mule_name, gid, exc)
        return jsonify({"error": str(exc)}), 502
