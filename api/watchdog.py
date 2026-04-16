"""
Watchdog — system-level VPN health monitor.

Background thread
-----------------
Started once when the Flask app initialises. Every WATCHDOG_INTERVAL seconds it:

  1. Lists all running mules.
  2. Calls ``check_mule_vpn()`` for each one.
  3. Tracks consecutive failures per mule.
  4. When a mule hits FAILURE_THRESHOLD consecutive failures it calls
     ``evacuate_mule()`` (migrate torrents → healthy mules, then kill).

In-memory state is accessed safely via a threading.Lock.

API endpoints
-------------
  GET  /api/watchdog/           — health status of all mules + watchdog config
  GET  /api/watchdog/<name>     — health status of a specific mule
  POST /api/watchdog/run        — trigger an immediate full check (synchronous)
  POST /api/watchdog/<name>/evacuate — manually evacuate a specific mule
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any

from flask import Blueprint, jsonify, request

from cli.log import get_logger, log_safe
from cli.docker_client import (
    get_docker_client,
    list_mules,
    check_mule_vpn,
    evacuate_mule,
)

log = get_logger(__name__)

watchdog_bp = Blueprint("watchdog", __name__, url_prefix="/api/watchdog")

# ── Configuration ─────────────────────────────────────────────────────────────
WATCHDOG_INTERVAL = 30   # seconds between full sweeps
FAILURE_THRESHOLD = 2    # consecutive check failures before evacuation

# ── Shared state (protected by _lock) ────────────────────────────────────────
_lock = threading.Lock()

# mule_name → {"healthy": bool, "ip": str|None, "reason": str, "checked_at": str,
#              "consecutive_failures": int, "evacuated": bool}
_mule_states: dict[str, dict[str, Any]] = {}

_watchdog_stats = {
    "started_at": None,
    "last_run_at": None,
    "total_sweeps": 0,
    "total_evacuations": 0,
}


# ── Internal helpers ──────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _run_sweep() -> list[dict]:
    """
    Check every running mule and trigger evacuation for any that exceed
    the failure threshold.  Returns a list of per-mule result dicts.
    """
    results: list[dict] = []

    try:
        client = get_docker_client()
        running_mules = [m for m in list_mules(client) if m.status == "running"]
    except RuntimeError as exc:
        log.error("watchdog sweep: cannot connect to Docker — %s", exc)
        return []

    checked_at = _now_iso()

    for mule in running_mules:
        result = check_mule_vpn(client, mule.name)
        result["checked_at"] = checked_at

        with _lock:
            prev = _mule_states.get(mule.name, {})
            consecutive = 0 if result["healthy"] else prev.get("consecutive_failures", 0) + 1
            already_evacuated = prev.get("evacuated", False)

            _mule_states[mule.name] = {
                **result,
                "consecutive_failures": consecutive,
                "evacuated": already_evacuated,
            }

        if not result["healthy"]:
            log.warning(
                "watchdog: mule=%s UNHEALTHY (failures=%d/%d) reason=%s",
                mule.name, consecutive, FAILURE_THRESHOLD, result["reason"],
            )

        # ── Trigger evacuation if threshold exceeded and not already done ──
        if not result["healthy"] and consecutive >= FAILURE_THRESHOLD and not already_evacuated:
            log.error(
                "watchdog: TRIGGERING EVACUATION for mule=%s (failures=%d)",
                mule.name, consecutive,
            )
            try:
                report = evacuate_mule(client, mule.name, kill_after=True)
                log.info(
                    "watchdog: evacuation complete mule=%s migrated=%d skipped=%d killed=%s",
                    mule.name,
                    len(report.get("migrated", [])),
                    len(report.get("skipped", [])),
                    report.get("killed"),
                )
            except Exception as exc:
                log.error("watchdog: evacuation error for mule=%s — %s", mule.name, exc)

            with _lock:
                if mule.name in _mule_states:
                    _mule_states[mule.name]["evacuated"] = True

            with _lock:
                _watchdog_stats["total_evacuations"] += 1

        results.append(result)

    with _lock:
        _watchdog_stats["last_run_at"] = checked_at
        _watchdog_stats["total_sweeps"] += 1

    return results


def _watchdog_loop() -> None:
    """Daemon thread: run a sweep every WATCHDOG_INTERVAL seconds."""
    log.info("watchdog: background thread started (interval=%ds)", WATCHDOG_INTERVAL)

    with _lock:
        _watchdog_stats["started_at"] = _now_iso()

    while True:
        try:
            _run_sweep()
        except Exception as exc:
            log.error("watchdog: unhandled error in sweep — %s", exc)
        time.sleep(WATCHDOG_INTERVAL)


def start_watchdog() -> None:
    """
    Start the background watchdog thread.

    Safe to call multiple times — will not start a second thread.
    Should be called from ``create_app()`` after blueprints are registered.
    """
    t = threading.Thread(target=_watchdog_loop, name="smuggler-watchdog", daemon=True)
    t.start()
    log.info("watchdog: daemon thread launched (tid=%s)", t.ident)


# ── API endpoints ─────────────────────────────────────────────────────────────

@watchdog_bp.get("/")
def watchdog_status():
    """Return health status for all mules + watchdog runtime stats."""
    log.debug("GET /api/watchdog/")
    with _lock:
        states = dict(_mule_states)
        stats = dict(_watchdog_stats)

    return jsonify({
        "config": {
            "interval_seconds": WATCHDOG_INTERVAL,
            "failure_threshold": FAILURE_THRESHOLD,
        },
        "stats": stats,
        "mules": list(states.values()),
    })


@watchdog_bp.get("/<mule_name>")
def watchdog_mule(mule_name: str):
    """Return the last known health status for a specific mule."""
    log.debug("GET /api/watchdog/%s", mule_name)
    with _lock:
        state = _mule_states.get(mule_name)

    if state is None:
        return jsonify({"error": f"No watchdog data for mule '{mule_name}'"}), 404

    return jsonify(state)


@watchdog_bp.post("/run")
def watchdog_run():
    """Trigger an immediate synchronous sweep of all mules."""
    log.info("POST /api/watchdog/run — manual sweep triggered")
    results = _run_sweep()
    return jsonify({"swept": len(results), "results": results})


@watchdog_bp.post("/<mule_name>/evacuate")
def watchdog_evacuate(mule_name: str):
    """
    Manually evacuate a specific mule.

    Query params:
      ?kill=true   (default) — kill and remove the mule after migration
      ?kill=false  — migrate only, leave container running
    """
    safe = log_safe(mule_name)
    kill_after = request.args.get("kill", "true").lower() != "false"
    log.info("POST /api/watchdog/%s/evacuate kill_after=%s", safe, kill_after)

    try:
        client = get_docker_client()
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500

    try:
        report = evacuate_mule(client, mule_name, kill_after=kill_after)
    except RuntimeError as exc:
        log.error("POST /api/watchdog/%s/evacuate: error — %s", safe, exc)
        return jsonify({"error": str(exc)}), 500

    with _lock:
        _watchdog_stats["total_evacuations"] += 1
        if mule_name in _mule_states:
            _mule_states[mule_name]["evacuated"] = True

    return jsonify(report)
