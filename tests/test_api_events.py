"""Tests for the events audit trail — database helpers and /api/events."""

from __future__ import annotations

import pytest

from api import database
from api.app import create_app
from api.database import list_events, prune_events, record_event


@pytest.fixture
def app():
    a = create_app()
    a.config["TESTING"] = True
    return a


@pytest.fixture
def client(app):
    return app.test_client()


# ─── record_event / list_events ──────────────────────────────────────────────

class TestRecordAndList:
    def test_roundtrip_preserves_payload(self):
        event_id = record_event(
            "observer", "vpn_status_change", severity="critical",
            mule="smuggler-mule-1", payload={"from": "healthy", "to": "dead"},
        )
        assert event_id > 0
        events = list_events(kind="vpn_status_change")
        assert len(events) == 1
        e = events[0]
        assert e["source"] == "observer"
        assert e["severity"] == "critical"
        assert e["mule"] == "smuggler-mule-1"
        assert e["payload"] == {"from": "healthy", "to": "dead"}
        assert e["ts"]

    def test_newest_first(self):
        first = record_event("test", "a")
        second = record_event("test", "b")
        events = list_events(source="test")
        assert [e["id"] for e in events] == [second, first]

    def test_payload_optional(self):
        record_event("test", "bare")
        assert list_events(kind="bare")[0]["payload"] is None

    def test_invalid_severity_becomes_info(self):
        record_event("test", "odd", severity="catastrophic")
        assert list_events(kind="odd")[0]["severity"] == "info"

    def test_filters(self):
        record_event("watchdog", "evac", severity="warning", mule="m1")
        record_event("observer", "evac", severity="warning", mule="m2")
        record_event("observer", "other", severity="info", mule="m2")

        assert len(list_events(source="watchdog")) == 1
        assert len(list_events(kind="evac")) == 2
        assert len(list_events(mule="m2")) == 2
        assert len(list_events(kind="evac", mule="m2")) == 1
        assert len(list_events(severity="warning")) == 2

    def test_before_id_pagination(self):
        ids = [record_event("test", "page") for _ in range(3)]
        older = list_events(kind="page", before_id=ids[2])
        assert [e["id"] for e in older] == [ids[1], ids[0]]

    def test_limit_capped_at_500(self):
        for _ in range(3):
            record_event("test", "lots")
        assert len(list_events(limit=2, kind="lots")) == 2
        assert len(list_events(limit=0, kind="lots")) == 1  # clamped to >= 1


# ─── prune_events ────────────────────────────────────────────────────────────

def _backdate(event_id: int, days: int) -> None:
    conn = database._get_conn()
    conn.execute(
        "UPDATE events SET ts = datetime('now', ?) WHERE id = ?",
        (f"-{days} days", event_id),
    )
    conn.commit()
    conn.close()


class TestPruneEvents:
    def test_age_based_pruning(self):
        old = record_event("test", "old")
        record_event("test", "fresh")
        _backdate(old, days=30)

        deleted = prune_events(max_age_days=14, max_rows=0)

        assert deleted == 1
        kinds = [e["kind"] for e in list_events(source="test")]
        assert kinds == ["fresh"]

    def test_row_cap_keeps_newest(self):
        ids = [record_event("test", "cap") for _ in range(10)]
        deleted = prune_events(max_age_days=0, max_rows=4)
        assert deleted == 6
        remaining = [e["id"] for e in list_events(kind="cap")]
        assert remaining == list(reversed(ids[-4:]))

    def test_noop_within_limits(self):
        record_event("test", "keep")
        assert prune_events(max_age_days=14, max_rows=100) == 0
        assert len(list_events(kind="keep")) == 1


# ─── GET /api/events/ ────────────────────────────────────────────────────────

class TestEventsEndpoint:
    def test_returns_recorded_events(self, client):
        record_event("observer", "snapshot", payload={"num_mules": 2})
        resp = client.get("/api/events/?kind=snapshot")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["count"] == 1
        assert data["events"][0]["payload"] == {"num_mules": 2}

    def test_filters_via_query_params(self, client):
        record_event("watchdog", "evacuation_triggered", severity="critical", mule="m1")
        record_event("observer", "mule_observed", mule="m2")

        resp = client.get("/api/events/?source=watchdog")
        events = resp.get_json()["events"]
        assert len(events) == 1
        assert events[0]["kind"] == "evacuation_triggered"

        resp = client.get("/api/events/?mule=m2&kind=mule_observed")
        assert resp.get_json()["count"] == 1

    def test_invalid_limit_rejected(self, client):
        assert client.get("/api/events/?limit=abc").status_code == 400

    def test_invalid_before_id_rejected(self, client):
        assert client.get("/api/events/?before_id=x").status_code == 400

    def test_empty_trail_ok(self, client):
        resp = client.get("/api/events/?kind=never_recorded")
        assert resp.status_code == 200
        assert resp.get_json() == {"events": [], "count": 0}
