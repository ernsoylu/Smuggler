"""Blueprint: /api/settings — backed by SQLite."""

from __future__ import annotations

import os
import re
from flask import Blueprint, request, jsonify

from api.database import get_all_settings, update_settings, get_setting
from api.settings_sync import sync_all_mules
from cli.log import get_logger, log_safe

log = get_logger(__name__)
settings_bp = Blueprint("settings", __name__, url_prefix="/api/settings")

# Validates an absolute Unix path with no null bytes (used for S6549 path sanitization)
_ABS_PATH_RE = re.compile(r'^/[^\x00]*$')


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

    # Validate and normalize download_dir (S6549: prevent path traversal)
    if "download_dir" in data and data["download_dir"]:
        raw = str(data["download_dir"]).strip()
        if not _ABS_PATH_RE.match(raw) or ".." in raw.split("/"):
            return jsonify({"error": "Download directory must be an absolute path without traversal sequences"}), 400
        data["download_dir"] = os.path.normpath(raw)

    result = update_settings(data)
    # Sync to running Mules
    sync_all_mules()
    return jsonify({"ok": True, "settings": result})
