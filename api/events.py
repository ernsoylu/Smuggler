"""Blueprint: /api/events — query the persisted audit/observability trail."""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from api.database import list_events
from cli.log import get_logger

log = get_logger(__name__)

events_bp = Blueprint("events", __name__, url_prefix="/api/events")

_FILTERS = ("source", "kind", "severity", "mule", "since")


@events_bp.get("/")
def list_all():
    """Events newest-first.

    Query params (all optional):
      limit      — max rows (1–500, default 100)
      before_id  — return events with id < before_id (backwards pagination)
      source     — e.g. observer | watchdog | api | logging
      kind       — e.g. vpn_status_change | secret_redacted | api_request
      severity   — debug | info | warning | error | critical
      mule       — mule name
      since      — ISO / SQLite datetime lower bound on ts
    """
    log.debug("GET /api/events/")
    try:
        limit = int(request.args.get("limit", "100"))
        before_raw = request.args.get("before_id")
        before_id = int(before_raw) if before_raw is not None else None
    except ValueError:
        return jsonify({"error": "limit and before_id must be integers"}), 400

    filters = {name: request.args.get(name) for name in _FILTERS}
    events = list_events(limit=limit, before_id=before_id, **filters)
    return jsonify({"events": events, "count": len(events)})
