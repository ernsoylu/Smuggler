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


def _serialize_files(dl: dict) -> list[dict]:
    files = []
    for f in dl.get("files", []):
        f_path = f.get("path", "")
        f_total = int(f.get("length", 0))
        f_comp = int(f.get("completedLength", 0))
        files.append({
            "index": int(f.get("index", 1)),
            "path": f_path,
            "name": Path(f_path).name if f_path else "—",
            "total_length": f_total,
            "completed_length": f_comp,
            "progress": round(f_comp / f_total * 100, 1) if f_total > 0 else 0.0,
            "selected": f.get("selected", "true") == "true",
        })
    return files


def _extract_tracker(bt: dict) -> str:
    announce_list = bt.get("announceList", [])
    if not announce_list or not announce_list[0]:
        return ""
    first = announce_list[0]
    return first[0] if isinstance(first, list) else str(first)


def _serialize_download(dl: dict, mule_name: str) -> dict:
    completed = int(dl.get("completedLength", 0))
    total = int(dl.get("totalLength", 0))
    uploaded = int(dl.get("uploadLength", 0))
    dl_speed = int(dl.get("downloadSpeed", 0))
    bt = dl.get("bittorrent", {})
    name = (
        bt.get("info", {}).get("name")
        or (dl.get("files") or [{}])[0].get("path", "")
    )

    remaining = total - completed
    eta = int(remaining / dl_speed) if dl_speed > 0 and remaining > 0 else -1
    ratio = round(uploaded / completed, 3) if completed > 0 else 0.0

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
        "progress": round(completed / total * 100, 1) if total > 0 else 0.0,
        "num_seeders": int(dl.get("numSeeders", 0)),
        "connections": int(dl.get("connections", 0)),
        "info_hash": dl.get("infoHash", ""),
        "is_seed": dl.get("seeder", "false") == "true",
        "save_path": dl.get("dir", ""),
        "piece_length": int(dl.get("pieceLength", 0)),
        "num_pieces": int(dl.get("numPieces", 0)),
        "eta": eta,
        "ratio": ratio,
        "tracker": _extract_tracker(bt),
        "comment": bt.get("comment", ""),
        "creation_date": int(bt.get("creationDate", 0)),
        "mode": bt.get("mode", ""),
        "error_code": dl.get("errorCode", ""),
        "error_message": dl.get("errorMessage", ""),
        "files": _serialize_files(dl),
        "is_metadata": dl.get("followedBy") is not None or "[METADATA]" in str(name),
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


def _add_magnet(aria2: Aria2Client, mule_name: str):
    import urllib.parse as _up
    data = request.get_json(silent=True) or {}
    magnet = data.get("magnet", "").strip()
    if not magnet:
        log.warning("POST /api/torrents/%s: missing magnet field", mule_name)
        return jsonify({"error": "magnet URI is required in JSON body"}), 400
    options: dict = {}
    try:
        qs = _up.parse_qs(_up.urlparse(magnet).query)
        dn = (qs.get("dn", [None])[0] or "").strip()
    except Exception:
        dn = ""
    if dn:
        options["dir"] = f"/downloads/{dn.replace('/', '_')}"
    log.info("POST /api/torrents/%s: adding magnet uri=%s", mule_name, magnet[:80])
    try:
        gid = aria2.add_magnet(magnet, options=options or None)
        log.info("POST /api/torrents/%s: magnet added gid=%s", mule_name, gid)
        return jsonify({"gid": gid}), 201
    except Aria2Error as exc:
        log.error("POST /api/torrents/%s: aria2 error adding magnet — %s", mule_name, exc)
        return jsonify({"error": str(exc)}), 502


def _add_torrent_file(aria2: Aria2Client, mule_name: str):
    file = request.files["torrent_file"]
    log.info("POST /api/torrents/%s: adding torrent file=%s", mule_name, file.filename)
    tmp = tempfile.NamedTemporaryFile(suffix=".torrent", delete=False)
    tmp.close()
    try:
        file.save(tmp.name)
        options: dict = {}
        if file.filename:
            base_name = Path(file.filename).stem.strip().replace("/", "_")
            if base_name:
                options["dir"] = f"/downloads/{base_name}"
        gid = aria2.add_torrent_file(tmp.name, options=options or None)
        log.info("POST /api/torrents/%s: torrent file added gid=%s", mule_name, gid)
        return jsonify({"gid": gid}), 201
    except Aria2Error as exc:
        log.error("POST /api/torrents/%s: aria2 error adding torrent file — %s", mule_name, exc)
        return jsonify({"error": str(exc)}), 502
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


# ─── POST /api/torrents/<mule> ─────────────────────────────────────────────

@torrents_bp.post("/<mule_name>")
def add(mule_name: str):
    """Add a torrent to a mule. JSON body: { "magnet": "..." } or multipart torrent_file."""
    log.info("POST /api/torrents/%s content_type=%s", mule_name, request.content_type)
    try:
        aria2 = _aria2_for(mule_name)
    except RuntimeError as exc:
        log.warning("POST /api/torrents/%s: mule error — %s", mule_name, exc)
        return jsonify({"error": str(exc)}), 404

    if request.is_json:
        return _add_magnet(aria2, mule_name)
    if "torrent_file" in request.files:
        return _add_torrent_file(aria2, mule_name)

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


# ─── GET /api/torrents/<mule>/<gid>/peers ──────────────────────────────────

@torrents_bp.get("/<mule_name>/<gid>/peers")
def get_peers(mule_name: str, gid: str):
    log.info("GET /api/torrents/%s/%s/peers", mule_name, gid)
    try:
        aria2 = _aria2_for(mule_name)
        raw = aria2.get_peers(gid)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 404
    except Aria2Error as exc:
        log.warning("GET /api/torrents/%s/%s/peers: aria2 error — %s", mule_name, gid, exc)
        return jsonify([])

    peers = []
    for p in raw:
        peers.append({
            "ip": p.get("ip", ""),
            "port": p.get("port", ""),
            "download_speed": int(p.get("downloadSpeed", 0)),
            "upload_speed": int(p.get("uploadSpeed", 0)),
            "seeder": p.get("seeder", False),
            "progress": round(p.get("progress", 0) / 100.0, 3) if "progress" in p else 0.0,
            "am_choking": p.get("amChoking", False),
            "peer_choking": p.get("peerChoking", False),
        })
    return jsonify(peers)


# ─── GET /api/torrents/<mule>/<gid>/options ────────────────────────────────

@torrents_bp.get("/<mule_name>/<gid>/options")
def get_options(mule_name: str, gid: str):
    log.info("GET /api/torrents/%s/%s/options", mule_name, gid)
    try:
        aria2 = _aria2_for(mule_name)
        opts = aria2.get_option(gid)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 404
    except Aria2Error as exc:
        log.error("GET /api/torrents/%s/%s/options: aria2 error — %s", mule_name, gid, exc)
        return jsonify({"error": str(exc)}), 502

    return jsonify({
        "max_download_speed": int(opts.get("max-download-limit", 0)),
        "max_upload_speed": int(opts.get("max-upload-limit", 0)),
        "max_connections": int(opts.get("max-connection-per-server", 1)),
    })


# ─── PATCH /api/torrents/<mule>/<gid>/options ─────────────────────────────

@torrents_bp.patch("/<mule_name>/<gid>/options")
def set_options(mule_name: str, gid: str):
    log.info("PATCH /api/torrents/%s/%s/options", mule_name, gid)
    data = request.get_json(silent=True) or {}
    aria2_opts: dict[str, str] = {}
    if "max_download_speed" in data:
        aria2_opts["max-download-limit"] = str(int(data["max_download_speed"]))
    if "max_upload_speed" in data:
        aria2_opts["max-upload-limit"] = str(int(data["max_upload_speed"]))
    if "max_connections" in data:
        aria2_opts["max-connection-per-server"] = str(int(data["max_connections"]))
    if not aria2_opts:
        return jsonify({"error": "No valid options provided"}), 400
    try:
        aria2 = _aria2_for(mule_name)
        aria2.change_option(gid, aria2_opts)
        log.info("PATCH /api/torrents/%s/%s/options: updated %s", mule_name, gid, aria2_opts)
        return jsonify({"ok": True})
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 404
    except Aria2Error as exc:
        log.error("PATCH /api/torrents/%s/%s/options: aria2 error — %s", mule_name, gid, exc)
        return jsonify({"error": str(exc)}), 502


# ─── PATCH /api/torrents/<mule>/<gid>/files ───────────────────────────────

@torrents_bp.patch("/<mule_name>/<gid>/files")
def set_file_selection(mule_name: str, gid: str):
    """Set which file indices (1-based) are selected for download."""
    log.info("PATCH /api/torrents/%s/%s/files", mule_name, gid)
    data = request.get_json(silent=True) or {}
    selected: list[int] = data.get("selected_indices", [])
    if not isinstance(selected, list):
        return jsonify({"error": "selected_indices must be a list of integers"}), 400
    select_str = ",".join(str(i) for i in sorted(selected)) if selected else ""
    try:
        aria2 = _aria2_for(mule_name)
        aria2.change_option(gid, {"select-file": select_str})
        log.info("PATCH /api/torrents/%s/%s/files: select-file=%s", mule_name, gid, select_str)
        return jsonify({"ok": True})
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 404
    except Aria2Error as exc:
        log.error("PATCH /api/torrents/%s/%s/files: aria2 error — %s", mule_name, gid, exc)
        return jsonify({"error": str(exc)}), 502
