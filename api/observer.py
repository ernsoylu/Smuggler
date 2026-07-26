"""
Observer — systemwide state and audit engine.

Background thread
-----------------
Started once when the Flask app initialises (unless SMG_OBSERVER_ENABLED is
false). Every OBSERVER_INTERVAL seconds it:

  1. Lists all mules and observes each one: container status, Docker's
     HEALTHCHECK verdict, the self-reported VPN phase file, and aria2
     liveness + transfer stats.
  2. Diffs against the previous sweep and persists every transition as an
     event in the ``events`` table (api/database.py).
  3. Harvests each running mule's stdout since the last sweep and scans it
     for secret-shaped content and kill-switch triggers.
  4. Records a periodic aggregate snapshot and enforces event retention.

It also subscribes to the log redaction filter, so any attempt to log a
secret anywhere in the process becomes a persisted ``secret_redacted`` event.

The watchdog stays the *actor* (evacuations); the observer is deliberately
read-only — it records, it never intervenes.

API endpoints
-------------
  GET  /api/observer/      — config + runtime stats + last observed state
  POST /api/observer/run   — trigger one synchronous sweep
"""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from datetime import datetime, timezone
from typing import Any

import docker
from flask import Blueprint, jsonify

from api.database import prune_events, record_event
from cli.aria2_client import Aria2Error
from cli.docker_client import (
    MuleInfo,
    aria2_for,
    get_docker_client,
    get_docker_health,
    get_mule_phase,
    list_mules,
)
from cli.log import get_logger, log_safe, on_redaction, redact, redaction_count, scan_secrets

log = get_logger(__name__)

observer_bp = Blueprint("observer", __name__, url_prefix="/api/observer")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


# ── Configuration ─────────────────────────────────────────────────────────────
OBSERVER_INTERVAL = _env_int("SMG_OBSERVER_INTERVAL", 30)      # seconds between sweeps
SNAPSHOT_EVERY = _env_int("SMG_OBSERVER_SNAPSHOT_SWEEPS", 10)  # snapshot every N sweeps
EVENTS_RETENTION_DAYS = _env_int("SMG_EVENTS_RETENTION_DAYS", 14)
EVENTS_MAX_ROWS = _env_int("SMG_EVENTS_MAX_ROWS", 50_000)
_PRUNE_EVERY = 20            # enforce retention every N sweeps
_ARIA2_TIMEOUT = 3           # seconds — a hung mule must not stall the sweep
_KS_MARKER = "KILL-SWITCH TRIGGERED"


def observer_enabled() -> bool:
    return os.environ.get("SMG_OBSERVER_ENABLED", "true").strip().lower() not in (
        "false", "0", "no", "off",
    )


# ── Shared state (protected by _lock) ────────────────────────────────────────
_lock = threading.Lock()
_start_lock = threading.Lock()
_observer_thread: threading.Thread | None = None

# mule_name → last observation dict (see _observe_mule)
_observed: dict[str, dict[str, Any]] = {}
# mule_name → unix ts up to which stdout has been harvested
_log_cursor: dict[str, int] = {}

_observer_stats: dict[str, Any] = {
    "started_at": None,
    "last_sweep_at": None,
    "total_sweeps": 0,
    "events_recorded": 0,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _emit(
    kind: str,
    *,
    severity: str = "info",
    mule: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    """Persist one observer event; a broken DB must not kill the sweep."""
    try:
        record_event("observer", kind, severity=severity, mule=mule, payload=payload)
    except sqlite3.Error as exc:
        log.error("observer: could not record event kind=%s — %s", kind, exc)
        return
    with _lock:
        _observer_stats["events_recorded"] += 1


def _redaction_event(info: dict) -> None:
    """on_redaction subscriber. Runs inside the logging pipeline, so it must
    not log — record_event is silent by contract."""
    try:
        record_event(
            "logging", "secret_redacted", severity="critical",
            payload={"logger": info.get("logger"), "patterns": info.get("patterns")},
        )
    except sqlite3.Error:
        pass


# ── Observation ──────────────────────────────────────────────────────────────

def _observe_mule(client, mule: MuleInfo) -> dict[str, Any]:
    """One point-in-time observation of a single mule. Never raises."""
    obs: dict[str, Any] = {
        "name": mule.name,
        "status": mule.status,
        "docker_health": None,
        "vpn_status": None,
        "vpn_phase": None,
        "vpn_ip": None,
        "vpn_reason": "",
        "aria2_alive": None,
        "aria2": None,
        "observed_at": _now_iso(),
    }
    if mule.status != "running":
        return obs

    obs["docker_health"] = get_docker_health(mule)

    phase = get_mule_phase(client, mule.name)
    obs["vpn_status"] = phase.get("status")
    obs["vpn_phase"] = phase.get("phase")
    obs["vpn_ip"] = phase.get("ip")
    obs["vpn_reason"] = phase.get("reason") or ""

    try:
        gs = aria2_for(mule, timeout=_ARIA2_TIMEOUT).get_global_stat()
        obs["aria2_alive"] = True
        obs["aria2"] = {
            "download_speed": int(gs.get("downloadSpeed", 0)),
            "upload_speed": int(gs.get("uploadSpeed", 0)),
            "num_active": int(gs.get("numActive", 0)),
            "num_waiting": int(gs.get("numWaiting", 0)),
            "num_stopped": int(gs.get("numStopped", 0)),
        }
    except Aria2Error as exc:
        obs["aria2_alive"] = False
        log.debug("observer: aria2 unreachable mule=%s — %s", mule.name, exc)
    return obs


# Fields whose change between sweeps is worth an event, with the kind to emit
# and how to grade the severity of the value transitioned *to*.
def _severity_for(field: str, value: Any) -> str:
    if field == "vpn_status" and value in ("dead", "stopped"):
        return "critical"
    if field == "status" and value != "running":
        return "warning"
    if field == "docker_health" and value == "unhealthy":
        return "warning"
    if field == "aria2_alive" and value is False:
        return "warning"
    return "info"


_DIFF_FIELDS = (
    ("status", "mule_status_change"),
    ("docker_health", "docker_health_change"),
    ("vpn_status", "vpn_status_change"),
    ("vpn_phase", "vpn_phase_change"),
    ("aria2_alive", "aria2_state_change"),
)


def _diff_and_emit(prev: dict[str, Any] | None, obs: dict[str, Any]) -> None:
    """Emit events for everything that changed since the previous sweep."""
    name = obs["name"]
    if prev is None:
        _emit("mule_observed", mule=name, payload={
            k: obs[k] for k in ("status", "docker_health", "vpn_status", "vpn_phase", "vpn_ip")
        })
        return

    for field, kind in _DIFF_FIELDS:
        if prev.get(field) == obs.get(field):
            continue
        payload: dict[str, Any] = {"from": prev.get(field), "to": obs.get(field)}
        if field == "vpn_status" and obs.get("vpn_reason"):
            payload["reason"] = obs["vpn_reason"]
        _emit(kind, severity=_severity_for(field, obs.get(field)), mule=name, payload=payload)


def _harvest_logs(mule: MuleInfo, since_ts: int) -> None:
    """Scan a mule's stdout written since *since_ts* for secrets and
    kill-switch triggers. The raw text is scanned, never stored."""
    try:
        raw = mule.container.logs(since=since_ts)
    except docker.errors.APIError as exc:
        log.debug("observer: cannot read logs mule=%s — %s", mule.name, exc)
        return
    text = raw.decode(errors="replace")
    if not text:
        return

    hits = scan_secrets(text)
    if hits:
        _emit("mule_log_secret", severity="critical", mule=mule.name, payload={
            "patterns": hits,
            "note": "secret-shaped content appeared in container stdout",
        })

    for line in text.splitlines():
        if _KS_MARKER in line:
            _emit("kill_switch_triggered", severity="critical", mule=mule.name,
                  payload={"line": redact(log_safe(line))[:300]})


def _snapshot(observations: list[dict[str, Any]]) -> None:
    """Aggregate snapshot event — the long-range time series."""
    by_status: dict[str, int] = {}
    totals = {"download_speed": 0, "upload_speed": 0,
              "num_active": 0, "num_waiting": 0, "num_stopped": 0}
    for obs in observations:
        by_status[obs["status"]] = by_status.get(obs["status"], 0) + 1
        if obs.get("aria2"):
            for key in totals:
                totals[key] += obs["aria2"][key]
    _emit("snapshot", payload={
        "num_mules": len(observations),
        "by_status": by_status,
        **totals,
        "log_redactions": redaction_count(),
    })


def _finalise_sweep(current_names: set[str]) -> tuple[list[str], int]:
    """Drop state for vanished mules; bump counters. Returns (gone, sweep#)."""
    with _lock:
        gone = [name for name in _observed if name not in current_names]
        for name in gone:
            del _observed[name]
            _log_cursor.pop(name, None)
        _observer_stats["last_sweep_at"] = _now_iso()
        _observer_stats["total_sweeps"] += 1
        return gone, _observer_stats["total_sweeps"]


def _run_sweep() -> list[dict[str, Any]]:
    """Observe every mule once, persist transitions, harvest logs.
    Returns the list of per-mule observations."""
    try:
        client = get_docker_client()
        all_mules = list_mules(client)
    except RuntimeError as exc:
        log.error("observer sweep: cannot connect to Docker — %s", exc)
        return []

    now_ts = int(time.time())
    observations: list[dict[str, Any]] = []

    for mule in all_mules:
        obs = _observe_mule(client, mule)
        with _lock:
            prev = _observed.get(mule.name)
            cursor = _log_cursor.get(mule.name)
        _diff_and_emit(prev, obs)
        if mule.status == "running":
            # First observation sets the cursor only — replaying a container's
            # whole backlog on every API restart would duplicate events.
            if cursor is not None:
                _harvest_logs(mule, cursor)
            with _lock:
                _log_cursor[mule.name] = now_ts
        with _lock:
            _observed[mule.name] = obs
        observations.append(obs)

    gone, sweeps = _finalise_sweep({m.name for m in all_mules})
    for name in gone:
        _emit("mule_removed", severity="warning", mule=name)

    if SNAPSHOT_EVERY > 0 and sweeps % SNAPSHOT_EVERY == 0:
        _snapshot(observations)

    if sweeps % _PRUNE_EVERY == 0:
        try:
            removed = prune_events(EVENTS_RETENTION_DAYS, EVENTS_MAX_ROWS)
            if removed:
                log.info("observer: retention pruned %d event(s)", removed)
        except sqlite3.Error as exc:
            log.error("observer: prune failed — %s", exc)

    return observations


def _observer_loop() -> None:
    """Daemon thread: run a sweep every OBSERVER_INTERVAL seconds."""
    log.info("observer: background thread started (interval=%ds)", OBSERVER_INTERVAL)
    with _lock:
        _observer_stats["started_at"] = _now_iso()

    while True:
        try:
            _run_sweep()
        except Exception as exc:
            log.error("observer: unhandled error in sweep — %s", exc)
        time.sleep(OBSERVER_INTERVAL)


def start_observer() -> None:
    """
    Start the background observer thread.

    Safe to call multiple times — will not start a second thread. The
    redaction subscription is registered even when the sweep thread is
    disabled, so ``secret_redacted`` events are never lost.
    """
    global _observer_thread

    on_redaction(_redaction_event)

    if not observer_enabled():
        log.info("observer: disabled via SMG_OBSERVER_ENABLED — not starting")
        return

    with _start_lock:
        if _observer_thread is not None and _observer_thread.is_alive():
            log.info("observer: already running (tid=%s) — not starting another",
                     _observer_thread.ident)
            return
        t = threading.Thread(target=_observer_loop, name="smuggler-observer", daemon=True)
        t.start()
        _observer_thread = t
        log.info("observer: daemon thread launched (tid=%s)", t.ident)


# ── API endpoints ─────────────────────────────────────────────────────────────

@observer_bp.get("/")
def observer_status():
    """Return observer config, runtime stats and the last observed state."""
    log.debug("GET /api/observer/")
    with _lock:
        states = list(_observed.values())
        stats = dict(_observer_stats)

    return jsonify({
        "config": {
            "enabled": observer_enabled(),
            "interval_seconds": OBSERVER_INTERVAL,
            "snapshot_every_sweeps": SNAPSHOT_EVERY,
            "events_retention_days": EVENTS_RETENTION_DAYS,
            "events_max_rows": EVENTS_MAX_ROWS,
        },
        "stats": {**stats, "log_redactions": redaction_count()},
        "mules": states,
    })


@observer_bp.post("/run")
def observer_run():
    """Trigger an immediate synchronous sweep."""
    log.info("POST /api/observer/run — manual sweep triggered")
    results = _run_sweep()
    return jsonify({"observed": len(results), "results": results})
