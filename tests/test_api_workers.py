"""Integration tests for /api/workers endpoints."""

from __future__ import annotations

import io
import json
from unittest.mock import MagicMock, patch

import pytest

from api.app import create_app


@pytest.fixture
def app():
    a = create_app()
    a.config["TESTING"] = True
    return a


@pytest.fixture
def client(app):
    return app.test_client()


def make_worker(name="dvd-worker-test", status="running"):
    from cli.docker_client import WorkerInfo
    c = MagicMock()
    c.name = name
    c.short_id = "abc123"
    c.status = status
    c.labels = {
        "dvd.worker": "true",
        "dvd.rpc_token": "tok",
        "dvd.rpc_port": "16800",
        "dvd.vpn_config": "vpn.conf",
    }
    return WorkerInfo(c)


IP_INFO = {"ip": "1.2.3.4", "city": "Auckland", "region": "Auckland",
           "country": "NZ", "org": "AS1234 Mega"}


# ─── GET /api/workers/ ───────────────────────────────────────────────────────

class TestListWorkers:
    def test_returns_empty_list(self, client):
        with patch("api.workers.get_docker_client"), \
             patch("api.workers.list_workers", return_value=[]):
            r = client.get("/api/workers/")
        assert r.status_code == 200
        assert r.get_json() == []

    def test_returns_serialized_workers(self, client):
        workers = [make_worker("dvd-worker-a"), make_worker("dvd-worker-b", "exited")]
        with patch("api.workers.get_docker_client"), \
             patch("api.workers.list_workers", return_value=workers):
            r = client.get("/api/workers/")
        data = r.get_json()
        assert r.status_code == 200
        assert len(data) == 2
        assert data[0]["name"] == "dvd-worker-a"
        assert data[1]["status"] == "exited"


# ─── POST /api/workers/ ──────────────────────────────────────────────────────

class TestCreateWorker:
    def _post(self, client, conf_content=b"[Interface]\n", name=None):
        data = {"vpn_config": (io.BytesIO(conf_content), "vpn.conf")}
        if name:
            data["name"] = name
        return client.post("/api/workers/", data=data,
                           content_type="multipart/form-data")

    def test_creates_worker_and_returns_ip(self, client):
        worker = make_worker()
        with patch("api.workers.get_docker_client"), \
             patch("api.workers.start_worker", return_value=worker), \
             patch("api.workers.wait_for_vpn", return_value=IP_INFO), \
             patch("api.workers.stop_worker"):
            r = self._post(client)
        assert r.status_code == 201
        data = r.get_json()
        assert data["name"] == "dvd-worker-test"
        assert data["ip_info"]["ip"] == "1.2.3.4"

    def test_returns_400_without_vpn_config(self, client):
        r = client.post("/api/workers/", data={}, content_type="multipart/form-data")
        assert r.status_code == 400

    def test_returns_502_when_vpn_fails(self, client):
        worker = make_worker()
        with patch("api.workers.get_docker_client"), \
             patch("api.workers.start_worker", return_value=worker), \
             patch("api.workers.wait_for_vpn",
                   side_effect=RuntimeError("VPN timed out")), \
             patch("api.workers.stop_worker") as mock_stop:
            r = self._post(client)
        assert r.status_code == 502
        assert "VPN timed out" in r.get_json()["error"]
        mock_stop.assert_called_once()


# ─── GET /api/workers/<name> ─────────────────────────────────────────────────

class TestGetWorker:
    def test_returns_worker(self, client):
        with patch("api.workers.get_docker_client"), \
             patch("api.workers.get_worker", return_value=make_worker()):
            r = client.get("/api/workers/dvd-worker-test")
        assert r.status_code == 200
        assert r.get_json()["name"] == "dvd-worker-test"

    def test_returns_404_for_unknown(self, client):
        with patch("api.workers.get_docker_client"), \
             patch("api.workers.get_worker",
                   side_effect=RuntimeError("Worker not found: 'ghost'")):
            r = client.get("/api/workers/ghost")
        assert r.status_code == 404


# ─── DELETE /api/workers/<name> ──────────────────────────────────────────────

class TestDeleteWorker:
    def test_stops_and_removes(self, client):
        with patch("api.workers.get_docker_client"), \
             patch("api.workers.stop_worker") as mock_stop:
            r = client.delete("/api/workers/dvd-worker-test")
        assert r.status_code == 200
        mock_stop.assert_called_once_with(mock_stop.call_args[0][0],
                                          "dvd-worker-test", remove=True)

    def test_keep_param(self, client):
        with patch("api.workers.get_docker_client"), \
             patch("api.workers.stop_worker") as mock_stop:
            r = client.delete("/api/workers/dvd-worker-test?keep=true")
        assert r.status_code == 200
        mock_stop.assert_called_once_with(mock_stop.call_args[0][0],
                                          "dvd-worker-test", remove=False)


# ─── POST /api/workers/<name>/kill ───────────────────────────────────────────

class TestKillWorker:
    def test_kills_worker(self, client):
        with patch("api.workers.get_docker_client"), \
             patch("api.workers.kill_worker") as mock_kill:
            r = client.post("/api/workers/dvd-worker-test/kill")
        assert r.status_code == 200
        mock_kill.assert_called_once()

    def test_returns_404_for_unknown(self, client):
        with patch("api.workers.get_docker_client"), \
             patch("api.workers.kill_worker",
                   side_effect=RuntimeError("Worker not found: 'ghost'")):
            r = client.post("/api/workers/ghost/kill")
        assert r.status_code == 404


# ─── GET /api/workers/<name>/ip ──────────────────────────────────────────────

class TestWorkerIp:
    def test_returns_ip_info(self, client):
        with patch("api.workers.get_docker_client"), \
             patch("api.workers.exec_in_worker",
                   return_value=json.dumps(IP_INFO)):
            r = client.get("/api/workers/dvd-worker-test/ip")
        assert r.status_code == 200
        assert r.get_json()["ip"] == "1.2.3.4"
        assert r.get_json()["country"] == "NZ"

    def test_returns_400_on_exec_error(self, client):
        with patch("api.workers.get_docker_client"), \
             patch("api.workers.exec_in_worker",
                   side_effect=RuntimeError("not running")):
            r = client.get("/api/workers/dvd-worker-test/ip")
        assert r.status_code == 400
