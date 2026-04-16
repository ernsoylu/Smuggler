"""Blueprint: /api/settings — backed by SQLite."""

from __future__ import annotations

from pathlib import Path
from flask import Blueprint, request, jsonify

from api.database import get_all_settings, update_settings, get_setting
from api.settings_sync import sync_all_mules
from cli.log import get_logger, log_safe

log = get_logger(__name__)
settings_bp = Blueprint("settings", __name__, url_prefix="/api/settings")


def read_settings() -> dict:
    """Convenience function used by other modules (e.g. workers.py)."""
    return get_all_settings()


@settings_bp.get("/")
def get_settings_endpoint():
    log.info("GET /api/settings/")
    return jsonify(get_all_settings())


@settings_bp.post("/")
def save_settings_endpoint():
    data = request.get_json(silent=True) or {}
    log.info("POST /api/settings/ keys=%s", list(data.keys()))

    # Resolve download_dir to clean absolute path; reject null bytes first (S6549)
    if "download_dir" in data and data["download_dir"]:
        raw = str(data["download_dir"])
        if "\x00" in raw:
            return jsonify({"error": "Invalid path"}), 400
        data["download_dir"] = str(Path(raw).resolve())

    result = update_settings(data)
    # Sync to running Mules
    sync_all_mules()
    return jsonify({"ok": True, "settings": result})
