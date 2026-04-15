"""Utility to sync Smuggler settings to running aria2 Mules."""

from __future__ import annotations

from api.database import get_all_settings
from cli.docker_client import get_docker_client, list_mules, get_mule
from cli.aria2_client import Aria2Client, Aria2Error
from cli.log import get_logger

log = get_logger(__name__)


def apply_settings_to_mule(mule_name: str, settings: dict[str, str] | None = None) -> bool:
    """
    Push global settings (speed limits, concurrency) to a running Mule.
    Returns True if successful, False otherwise.
    """
    if settings is None:
        settings = get_all_settings()

    log.info("apply_settings_to_mule: syncing mule=%s", mule_name)
    
    docker = get_docker_client()
    try:
        w = get_mule(docker, mule_name)
    except RuntimeError:
        log.warning("apply_settings_to_mule: mule=%s not found", mule_name)
        return False

    if w.status != "running":
        log.debug("apply_settings_to_mule: mule=%s is not running (status=%s)", mule_name, w.status)
        return False

    # Map Smuggler settings to aria2 options
    aria2_options = {
        "max-concurrent-downloads": settings.get("max_concurrent_downloads", "5"),
        "max-overall-download-limit": settings.get("max_download_speed", "0"),
        "max-overall-upload-limit": settings.get("max_upload_speed", "0"),
    }

    aria2 = Aria2Client(host="localhost", port=w.rpc_port, token=w.rpc_token)
    try:
        aria2.change_global_option(aria2_options)
        log.info("apply_settings_to_mule: successfully synced mule=%s", mule_name)
        return True
    except Aria2Error as exc:
        log.error("apply_settings_to_mule: failed to sync mule=%s — %s", mule_name, exc)
        return False


def sync_all_mules() -> None:
    """Iterate through all running Mules and apply current settings."""
    log.info("sync_all_mules: starting global sync")
    settings = get_all_settings()
    docker = get_docker_client()
    mules = list_mules(docker)
    
    running_count = 0
    synced_count = 0
    
    for w in mules:
        if w.status == "running":
            running_count += 1
            if apply_settings_to_mule(w.name, settings):
                synced_count += 1
                
    log.info("sync_all_mules: done. running=%d synced=%d", running_count, synced_count)
