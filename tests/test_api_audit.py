"""Tests for the request access-log / audit hook in create_app()."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from api.app import create_app
from api.database import list_events


@pytest.fixture
def client():
    a = create_app()
    a.config["TESTING"] = True
    return a.test_client()


class TestAccessAudit:
    def test_mutating_request_recorded(self, client):
        with patch("api.watchdog._run_sweep", return_value=[]):
            resp = client.post("/api/watchdog/run")
        assert resp.status_code == 200

        events = list_events(kind="api_request")
        assert len(events) == 1
        payload = events[0]["payload"]
        assert payload["method"] == "POST"
        assert payload["path"] == "/api/watchdog/run"
        assert payload["status"] == 200
        assert payload["duration_ms"] >= 0

    def test_get_requests_not_persisted(self, client):
        client.get("/api/events/")
        client.get("/api/health/")
        assert list_events(kind="api_request") == []

    def test_rejected_request_still_audited(self, client, monkeypatch):
        monkeypatch.setenv("SMG_API_TOKEN", "sekrit-token")
        resp = client.post("/api/watchdog/run")  # no X-Smuggler-Token header
        assert resp.status_code == 401

        events = list_events(kind="api_request")
        assert len(events) == 1
        assert events[0]["payload"]["status"] == 401

    def test_multiple_mutations_accumulate(self, client):
        with patch("api.watchdog._run_sweep", return_value=[]):
            client.post("/api/watchdog/run")
            client.post("/api/watchdog/run")
        assert len(list_events(kind="api_request")) == 2
