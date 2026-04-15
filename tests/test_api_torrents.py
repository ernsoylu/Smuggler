"""Integration tests for /api/torrents endpoints."""

from __future__ import annotations

import io
import json
from unittest.mock import MagicMock, patch

import pytest
import responses as resp_lib
import requests

from api.app import create_app
from cli.aria2_client import Aria2Error

ARIA2_URL = "http://localhost:16800/jsonrpc"


@pytest.fixture
def app():
    a = create_app()
    a.config["TESTING"] = True
    return a


@pytest.fixture
def client(app):
    return app.test_client()


def make_worker_info(name="dvd-worker-test", status="running"):
    from cli.docker_client import WorkerInfo
    c = MagicMock()
    c.name = name
    c.short_id = "abc"
    c.status = status
    c.labels = {
        "dvd.worker": "true",
        "dvd.rpc_token": "tok",
        "dvd.rpc_port": "16800",
        "dvd.vpn_config": "vpn.conf",
    }
    return WorkerInfo(c)


ACTIVE_DL = {
    "gid": "abc123",
    "status": "active",
    "completedLength": "500000000",
    "totalLength": "1000000000",
    "downloadSpeed": "2097152",
    "uploadSpeed": "524288",
    "numSeeders": "10",
    "connections": "5",
    "bittorrent": {"info": {"name": "MyMovie.mkv"}},
    "files": [],
}


def rpc_ok(result):
    return {"jsonrpc": "2.0", "id": "dvd", "result": result}


# ─── GET /api/torrents/ ──────────────────────────────────────────────────────

class TestListAllTorrents:
    @resp_lib.activate
    def test_aggregates_across_workers(self, client):
        worker = make_worker_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok([ACTIVE_DL]))  # tellActive
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok([]))           # tellWaiting
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok([]))           # tellStopped

        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.list_workers", return_value=[worker]):
            r = client.get("/api/torrents/")

        assert r.status_code == 200
        data = r.get_json()
        assert len(data) == 1
        assert data[0]["gid"] == "abc123"
        assert data[0]["name"] == "MyMovie.mkv"
        assert data[0]["progress"] == 50.0

    def test_returns_empty_when_no_workers(self, client):
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.list_workers", return_value=[]):
            r = client.get("/api/torrents/")
        assert r.status_code == 200
        assert r.get_json() == []


# ─── GET /api/torrents/<worker> ──────────────────────────────────────────────

class TestListWorkerTorrents:
    @resp_lib.activate
    def test_lists_torrents_for_worker(self, client):
        worker = make_worker_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok([ACTIVE_DL]))
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok([]))
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok([]))

        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_worker", return_value=worker):
            r = client.get("/api/torrents/dvd-worker-test")

        assert r.status_code == 200
        assert len(r.get_json()) == 1

    def test_returns_404_for_unknown_worker(self, client):
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_worker",
                   side_effect=RuntimeError("Worker not found")):
            r = client.get("/api/torrents/ghost")
        assert r.status_code == 404


# ─── POST /api/torrents/<worker> ─────────────────────────────────────────────

class TestAddTorrent:
    @resp_lib.activate
    def test_add_magnet(self, client):
        worker = make_worker_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok("newgid123"))

        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_worker", return_value=worker):
            r = client.post(
                "/api/torrents/dvd-worker-test",
                json={"magnet": "magnet:?xt=urn:btih:abc"},
            )

        assert r.status_code == 201
        assert r.get_json()["gid"] == "newgid123"

    @resp_lib.activate
    def test_add_torrent_file(self, client):
        worker = make_worker_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok("filegid456"))

        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_worker", return_value=worker):
            r = client.post(
                "/api/torrents/dvd-worker-test",
                data={"torrent_file": (io.BytesIO(b"d8:announce...e"), "file.torrent")},
                content_type="multipart/form-data",
            )

        assert r.status_code == 201
        assert r.get_json()["gid"] == "filegid456"

    def test_returns_400_without_payload(self, client):
        worker = make_worker_info()
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_worker", return_value=worker):
            r = client.post("/api/torrents/dvd-worker-test",
                            json={})
        assert r.status_code == 400

    @resp_lib.activate
    def test_returns_502_on_aria2_error(self, client):
        worker = make_worker_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL,
                     json={"jsonrpc": "2.0", "id": "dvd",
                           "error": {"code": -1, "message": "Invalid URI"}})

        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_worker", return_value=worker):
            r = client.post(
                "/api/torrents/dvd-worker-test",
                json={"magnet": "magnet:?xt=bad"},
            )

        assert r.status_code == 502
        assert "Invalid URI" in r.get_json()["error"]


# ─── DELETE /api/torrents/<worker>/<gid> ─────────────────────────────────────

class TestRemoveTorrent:
    @resp_lib.activate
    def test_removes_torrent(self, client):
        worker = make_worker_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok("abc123"))

        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_worker", return_value=worker):
            r = client.delete("/api/torrents/dvd-worker-test/abc123")

        assert r.status_code == 200
        assert r.get_json()["ok"] is True


# ─── POST /api/torrents/<worker>/<gid>/pause|resume ──────────────────────────

class TestPauseResume:
    @resp_lib.activate
    def test_pause(self, client):
        worker = make_worker_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok("abc123"))

        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_worker", return_value=worker):
            r = client.post("/api/torrents/dvd-worker-test/abc123/pause")

        assert r.status_code == 200

    @resp_lib.activate
    def test_resume(self, client):
        worker = make_worker_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok("abc123"))

        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_worker", return_value=worker):
            r = client.post("/api/torrents/dvd-worker-test/abc123/resume")

        assert r.status_code == 200
