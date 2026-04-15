"""Integration tests for /api/mules endpoints."""

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


def make_mule(name="smuggler-mule-test", status="running"):
    from cli.docker_client import MuleInfo
    c = MagicMock()
    c.name = name
    c.short_id = "abc123"
    c.status = status
    c.labels = {
        "smuggler.mule": "true",
        "smuggler.rpc_token": "tok",
        "smuggler.rpc_port": "16800",
        "smuggler.vpn_config": "vpn.conf",
    }
    return MuleInfo(c)


IP_INFO = {"ip": "1.2.3.4", "city": "Auckland", "region": "Auckland",
           "country": "NZ", "org": "AS1234 Mega"}


# ─── GET /api/mules/ ─────────────────────────────────────────────────────────

class TestListMules:
    def test_returns_empty_list(self, client):
        with patch("api.mules.get_docker_client"), \
             patch("api.mules.list_mules", return_value=[]):
            r = client.get("/api/mules/")
        assert r.status_code == 200
        assert r.get_json() == []

    def test_returns_serialized_mules(self, client):
        mules = [make_mule("smuggler-mule-a"), make_mule("smuggler-mule-b", "exited")]
        with patch("api.mules.get_docker_client"), \
             patch("api.mules.list_mules", return_value=mules):
            r = client.get("/api/mules/")
        data = r.get_json()
        assert r.status_code == 200
        assert len(data) == 2
        assert data[0]["name"] == "smuggler-mule-a"
        assert data[1]["status"] == "exited"


# ─── POST /api/mules/ ────────────────────────────────────────────────────────

class TestCreateMule:
    def _post(self, client, conf_content=b"[Interface]\n", name=None):
        data = {"vpn_config": (io.BytesIO(conf_content), "vpn.conf")}
        if name:
            data["name"] = name
        return client.post("/api/mules/", data=data,
                           content_type="multipart/form-data")

    def test_creates_mule_and_returns_ip(self, client):
        mule = make_mule()
        with patch("api.mules.get_docker_client"), \
             patch("api.mules.start_mule", return_value=mule), \
             patch("api.mules.wait_for_vpn", return_value=IP_INFO), \
             patch("api.mules.stop_mule"):
            r = self._post(client)
        assert r.status_code == 201
        data = r.get_json()
        assert data["name"] == "smuggler-mule-test"
        assert data["ip_info"]["ip"] == "1.2.3.4"

    def test_returns_400_without_vpn_config(self, client):
        r = client.post("/api/mules/", data={}, content_type="multipart/form-data")
        assert r.status_code == 400

    def test_returns_502_when_vpn_fails(self, client):
        mule = make_mule()
        with patch("api.mules.get_docker_client"), \
             patch("api.mules.start_mule", return_value=mule), \
             patch("api.mules.wait_for_vpn",
                   side_effect=RuntimeError("VPN timed out")), \
             patch("api.mules.stop_mule") as mock_stop:
            r = self._post(client)
        assert r.status_code == 502
        assert "VPN timed out" in r.get_json()["error"]
        mock_stop.assert_called_once()


# ─── GET /api/mules/<name> ────────────────────────────────────────────────────

class TestGetMule:
    def test_returns_mule(self, client):
        with patch("api.mules.get_docker_client"), \
             patch("api.mules.get_mule", return_value=make_mule()):
            r = client.get("/api/mules/smuggler-mule-test")
        assert r.status_code == 200
        assert r.get_json()["name"] == "smuggler-mule-test"

    def test_returns_404_for_unknown(self, client):
        with patch("api.mules.get_docker_client"), \
             patch("api.mules.get_mule",
                   side_effect=RuntimeError("Mule not found: 'ghost'")):
            r = client.get("/api/mules/ghost")
        assert r.status_code == 404


# ─── DELETE /api/mules/<name> ────────────────────────────────────────────────

class TestDeleteMule:
    def test_stops_and_removes(self, client):
        with patch("api.mules.get_docker_client"), \
             patch("api.mules.stop_mule") as mock_stop:
            r = client.delete("/api/mules/smuggler-mule-test")
        assert r.status_code == 200
        mock_stop.assert_called_once_with(mock_stop.call_args[0][0],
                                          "smuggler-mule-test", remove=True)

    def test_keep_param(self, client):
        with patch("api.mules.get_docker_client"), \
             patch("api.mules.stop_mule") as mock_stop:
            r = client.delete("/api/mules/smuggler-mule-test?keep=true")
        assert r.status_code == 200
        mock_stop.assert_called_once_with(mock_stop.call_args[0][0],
                                          "smuggler-mule-test", remove=False)


# ─── POST /api/mules/<name>/kill ─────────────────────────────────────────────

class TestKillMule:
    def test_kills_mule(self, client):
        with patch("api.mules.get_docker_client"), \
             patch("api.mules.kill_mule") as mock_kill:
            r = client.post("/api/mules/smuggler-mule-test/kill")
        assert r.status_code == 200
        mock_kill.assert_called_once()

    def test_returns_404_for_unknown(self, client):
        with patch("api.mules.get_docker_client"), \
             patch("api.mules.kill_mule",
                   side_effect=RuntimeError("Mule not found: 'ghost'")):
            r = client.post("/api/mules/ghost/kill")
        assert r.status_code == 404


# ─── GET /api/mules/<name>/ip ────────────────────────────────────────────────

class TestMuleIp:
    def test_returns_ip_info(self, client):
        with patch("api.mules.get_docker_client"), \
             patch("api.mules.exec_in_mule",
                   return_value=json.dumps(IP_INFO)):
            r = client.get("/api/mules/smuggler-mule-test/ip")
        assert r.status_code == 200
        assert r.get_json()["ip"] == "1.2.3.4"
        assert r.get_json()["country"] == "NZ"

    def test_returns_400_on_exec_error(self, client):
        with patch("api.mules.get_docker_client"), \
             patch("api.mules.exec_in_mule",
                   side_effect=RuntimeError("not running")):
            r = client.get("/api/mules/smuggler-mule-test/ip")
        assert r.status_code == 400
