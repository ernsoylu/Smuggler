"""Blueprint: /api/deployments — asynchronous mule deployment with real progress.

``POST /api/configs/<id>/deploy`` blocks for up to 90 seconds, which occupies one
of gunicorn's eight threads and tells the caller nothing until it finishes. The
UI papered over that by animating stages off a timer, so "Establishing VPN
connection…" appeared 8 seconds in whether or not anything was connecting.

This resource runs the same deploy in a background thread and reports the phase
the mule itself writes to ``/tmp/vpn_health.json``. Progress shown to the user is
therefore something that actually happened.

Job state is in-process and deliberately so: the API runs a single gunicorn
worker, jobs are meaningless across a restart, and a completed job is only
interesting until the client next polls.
"""

from __future__ import annotations

import secrets
import threading
import time
from typing import Any

from flask import Blueprint, jsonify, request

from api.configs import DeployError, check_deployable, perform_deploy
from cli.docker_client import get_docker_client, get_mule_phase, is_valid_mule_name, MULE_NAME_ERROR
from cli.log import get_logger, log_safe

log = get_logger(__name__)
deployments_bp = Blueprint("deployments", __name__, url_prefix="/api/deployments")

# Terminal jobs are dropped this long after finishing, so a client that stops
# polling cannot leak entries forever.
_JOB_TTL_SECONDS = 600
# Hard cap so a pathological client cannot grow the map without bound.
_MAX_JOBS = 64

_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}

# Ordered so the UI can render a progress bar without hardcoding the list.
PHASE_ORDER = ("starting", "configuring", "connecting", "deployed")


def _now() -> float:
    return time.time()


def _prune_locked() -> None:
    """Drop expired terminal jobs. Caller must hold ``_lock``."""
    cutoff = _now() - _JOB_TTL_SECONDS
    stale = [
        jid for jid, j in _jobs.items()
        if j["state"] in ("succeeded", "failed") and j["finished_at"]
        and j["finished_at"] < cutoff
    ]
    for jid in stale:
        del _jobs[jid]
    # If still over the cap, evict the oldest finished jobs first.
    if len(_jobs) > _MAX_JOBS:
        finished = sorted(
            (j for j in _jobs.values() if j["state"] in ("succeeded", "failed")),
            key=lambda j: j["finished_at"] or 0,
        )
        for j in finished[: len(_jobs) - _MAX_JOBS]:
            _jobs.pop(j["id"], None)


def _public(job: dict[str, Any]) -> dict[str, Any]:
    """Strip internal bookkeeping before returning a job to a client."""
    return {
        "id": job["id"],
        "config_id": job["config_id"],
        "state": job["state"],
        "phase": job["phase"],
        "phase_index": PHASE_ORDER.index(job["phase"]) if job["phase"] in PHASE_ORDER else 0,
        "phase_count": len(PHASE_ORDER),
        "detail": job["detail"],
        "mule": job["mule"],
        "result": job["result"],
        "error": job["error"],
        "started_at": job["started_at"],
        "finished_at": job["finished_at"],
    }


def _set(job_id: str, **fields) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job:
            job.update(fields)


def _run_deploy(job_id: str, config_id: int, config: dict, mule_name: str | None) -> None:
    """Background worker: deploy, tracking the mule's self-reported phase."""
    stop_polling = threading.Event()

    def _on_started(name: str) -> None:
        _set(job_id, mule=name, phase="configuring",
             detail="container created, bringing up the tunnel")
        threading.Thread(
            target=_poll_phase, args=(job_id, name, stop_polling),
            name=f"smuggler-deploy-phase-{job_id[:8]}", daemon=True,
        ).start()

    try:
        result = perform_deploy(config_id, config, mule_name, on_started=_on_started)
    except DeployError as exc:
        stop_polling.set()
        log.error("deployment %s failed — %s", job_id, exc)
        _set(job_id, state="failed", error=str(exc), status=exc.status,
             detail=str(exc), finished_at=_now())
        return
    except Exception as exc:  # noqa: BLE001 - a job thread must never die silently
        stop_polling.set()
        log.exception("deployment %s crashed", job_id)
        _set(job_id, state="failed", error=f"Unexpected error: {exc}", status=500,
             detail="Unexpected error", finished_at=_now())
        return

    stop_polling.set()
    _set(job_id, state="succeeded", phase="deployed", result=result,
         mule=result["name"], detail="Mule is live and the VPN is connected.",
         finished_at=_now())
    log.info("deployment %s succeeded mule=%s", job_id, log_safe(result["name"]))


def _poll_phase(job_id: str, mule_name: str, stop: threading.Event) -> None:
    """Mirror the mule's own phase into the job while the deploy runs."""
    try:
        client = get_docker_client()
    except RuntimeError:
        return
    while not stop.wait(1.5):
        try:
            info = get_mule_phase(client, mule_name)
        except Exception:  # noqa: BLE001 - progress reporting must never break a deploy
            continue
        with _lock:
            job = _jobs.get(job_id)
            if not job or job["state"] != "running":
                return
            # Never move backwards: a transient read failure returns "starting".
            current = PHASE_ORDER.index(job["phase"]) if job["phase"] in PHASE_ORDER else 0
            reported = PHASE_ORDER.index(info["phase"]) if info["phase"] in PHASE_ORDER else 0
            if reported > current:
                job["phase"] = info["phase"]
                job["detail"] = info["reason"] or info["phase"]


# ─── POST /api/deployments/ ──────────────────────────────────────────────────

@deployments_bp.post("/")
def start_deployment():
    """Begin deploying a mule and return immediately with a job to poll.

    JSON body:
      - config_id (int, required)
      - name      (str, optional) — mule name override

    Returns 202 with the job. Validation failures still return their usual
    status (404/409/400) because they are known before any work starts.
    """
    data = request.get_json(silent=True) or {}
    config_id = data.get("config_id")
    if not isinstance(config_id, int):
        return jsonify({"error": "config_id (int) is required"}), 400
    # int() so everything downstream (log line, job dict) carries a provably
    # numeric value rather than request-tainted input.
    config_id = int(config_id)

    name = data.get("name") or None
    if name is not None and not is_valid_mule_name(name):
        return jsonify({"error": MULE_NAME_ERROR}), 400

    log.info("POST /api/deployments/ config_id=%d", config_id)
    try:
        config = check_deployable(config_id)
    except DeployError as exc:
        return jsonify({"error": str(exc), **exc.extra}), exc.status

    job_id = secrets.token_urlsafe(12)
    job = {
        "id": job_id,
        "config_id": config_id,
        "state": "running",
        "phase": "starting",
        "detail": "starting the mule container",
        "mule": None,
        "result": None,
        "error": None,
        "status": None,
        "started_at": _now(),
        "finished_at": None,
    }
    with _lock:
        _prune_locked()
        _jobs[job_id] = job
        # Snapshot before starting the worker: the thread mutates this dict in
        # place, so reading it afterwards can race and report a job that already
        # finished. A 202 should describe what was accepted.
        payload = _public(job)

    threading.Thread(
        target=_run_deploy, args=(job_id, config_id, config, name),
        name=f"smuggler-deploy-{job_id[:8]}", daemon=True,
    ).start()

    return jsonify(payload), 202


# ─── GET /api/deployments/<job_id> ───────────────────────────────────────────

@deployments_bp.get("/<job_id>")
def get_deployment(job_id: str):
    with _lock:
        job = _jobs.get(job_id)
        payload = _public(job) if job else None
    if payload is None:
        return jsonify({"error": "Deployment not found or expired"}), 404
    return jsonify(payload)


# ─── GET /api/deployments/ ───────────────────────────────────────────────────

@deployments_bp.get("/")
def list_deployments():
    """All tracked deployments, newest first — lets a reloaded UI pick them up."""
    with _lock:
        payload = sorted(
            (_public(j) for j in _jobs.values()),
            key=lambda j: j["started_at"], reverse=True,
        )
    return jsonify(payload)
