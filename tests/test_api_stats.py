"""Integration tests for /api/stats endpoint."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
import responses as resp_lib

from api.app import create_app

ARIA2_URL = "http://localhost:16800/jsonrpc"


@pytest.fixture
def app():
    a = create_app()
    a.config["TESTING"] = True
    return a


@pytest.fixture
def client(app):
    return app.test_client()


def make_worker_info(name="dvd-worker-test"):
    from cli.docker_client import WorkerInfo
    c = MagicMock()
    c.name = name
    c.short_id = "abc"
    c.status = "running"
    c.labels = {
        "dvd.worker": "true",
        "dvd.rpc_token": "tok",
        "dvd.rpc_port": "16800",
        "dvd.vpn_config": "vpn.conf",
    }
    return WorkerInfo(c)


def rpc_ok(result):
    return {"jsonrpc": "2.0", "id": "dvd", "result": result}


class TestGlobalStats:
    @resp_lib.activate
    def test_returns_aggregated_stats(self, client):
        worker = make_worker_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok({
            "downloadSpeed": "1048576",
            "uploadSpeed": "524288",
            "numActive": "2",
            "numWaiting": "1",
            "numStopped": "0",
        }))

        with patch("api.stats.get_docker_client"), \
             patch("api.stats.list_workers", return_value=[worker]):
            r = client.get("/api/stats/")

        assert r.status_code == 200
        data = r.get_json()
        assert data["download_speed"] == 1048576
        assert data["upload_speed"] == 524288
        assert data["num_active"] == 2
        assert data["num_workers"] == 1

    def test_returns_zeros_when_no_workers(self, client):
        with patch("api.stats.get_docker_client"), \
             patch("api.stats.list_workers", return_value=[]):
            r = client.get("/api/stats/")

        assert r.status_code == 200
        data = r.get_json()
        assert data["download_speed"] == 0
        assert data["num_workers"] == 0
