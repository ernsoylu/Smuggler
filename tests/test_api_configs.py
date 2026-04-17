"""Integration tests for /api/configs endpoints."""

from __future__ import annotations

import io
from unittest.mock import MagicMock, patch

import pytest

from api.app import create_app
from api.configs import _detect_vpn_type, _detect_requires_auth


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


# ─── Unit: helper functions ──────────────────────────────────────────────────

class TestDetectVpnType:
    def test_conf_is_wireguard(self):
        assert _detect_vpn_type("vpn.conf") == "wireguard"

    def test_ovpn_is_openvpn(self):
        assert _detect_vpn_type("vpn.ovpn") == "openvpn"

    def test_ovpn_case_insensitive(self):
        assert _detect_vpn_type("VPN.OVPN") == "openvpn"

    def test_unknown_extension_is_wireguard(self):
        assert _detect_vpn_type("vpn.txt") == "wireguard"


class TestDetectRequiresAuth:
    def test_bare_directive_returns_true(self):
        content = b"client\nauth-user-pass\nremote vpn.example.com\n"
        assert _detect_requires_auth(content) is True

    def test_directive_with_file_returns_false(self):
        content = b"client\nauth-user-pass /etc/openvpn/creds.txt\n"
        assert _detect_requires_auth(content) is False

    def test_no_directive_returns_false(self):
        content = b"client\nremote vpn.example.com 1194\n"
        assert _detect_requires_auth(content) is False

    def test_commented_directive_returns_false(self):
        content = b"# auth-user-pass\n;auth-user-pass\nclient\n"
        assert _detect_requires_auth(content) is False

    def test_case_insensitive_directive(self):
        content = b"AUTH-USER-PASS\n"
        assert _detect_requires_auth(content) is True


# ─── GET /api/configs/ ───────────────────────────────────────────────────────

class TestListConfigs:
    def test_returns_config_list(self, client):
        configs = [{"id": 1, "name": "vpn1", "vpn_type": "wireguard"}]
        with patch("api.configs.list_vpn_configs", return_value=configs):
            r = client.get("/api/configs/")
        assert r.status_code == 200
        assert r.get_json() == configs

    def test_returns_empty_list(self, client):
        with patch("api.configs.list_vpn_configs", return_value=[]):
            r = client.get("/api/configs/")
        assert r.status_code == 200
        assert r.get_json() == []


# ─── POST /api/configs/ ──────────────────────────────────────────────────────

class TestUploadConfig:
    def _post(self, client, filename="vpn.conf", content=b"[Interface]\n", name=None, **kwargs):
        data = {"config_file": (io.BytesIO(content), filename)}
        if name:
            data["name"] = name
        data.update(kwargs)
        return client.post("/api/configs/", data=data, content_type="multipart/form-data")

    def test_returns_400_without_file(self, client):
        r = client.post("/api/configs/", data={}, content_type="multipart/form-data")
        assert r.status_code == 400
        assert "config_file is required" in r.get_json()["error"]

    def test_returns_400_without_filename(self, client):
        data = {"config_file": (io.BytesIO(b"data"), "")}
        r = client.post("/api/configs/", data=data, content_type="multipart/form-data")
        assert r.status_code == 400
        assert "filename is required" in r.get_json()["error"]

    def test_uploads_wireguard_config(self, client):
        with patch("api.configs.add_vpn_config", return_value=42):
            r = self._post(client, filename="wg0.conf", name="my-vpn")
        assert r.status_code == 201
        body = r.get_json()
        assert body["id"] == 42
        assert body["vpn_type"] == "wireguard"
        assert body["name"] == "my-vpn"

    def test_uses_stem_as_name_when_missing(self, client):
        with patch("api.configs.add_vpn_config", return_value=1):
            r = self._post(client, filename="myvpn.conf")
        assert r.get_json()["name"] == "myvpn"

    def test_uploads_openvpn_without_auth(self, client):
        content = b"client\nremote vpn.example.com 1194\n"
        with patch("api.configs.add_vpn_config", return_value=7):
            r = self._post(client, filename="vpn.ovpn", content=content)
        assert r.status_code == 201
        body = r.get_json()
        assert body["vpn_type"] == "openvpn"
        assert body["requires_auth"] is False

    def test_uploads_openvpn_with_auth(self, client):
        content = b"client\nauth-user-pass\nremote vpn.example.com 1194\n"
        with patch("api.configs.add_vpn_config", return_value=8):
            r = self._post(client, filename="vpn.ovpn", content=content,
                           username="user", password="pass")
        assert r.status_code == 201
        body = r.get_json()
        assert body["requires_auth"] is True


# ─── DELETE /api/configs/<id> ────────────────────────────────────────────────

class TestRemoveConfig:
    def test_deletes_existing_config(self, client):
        with patch("api.configs.delete_vpn_config", return_value=True):
            r = client.delete("/api/configs/1")
        assert r.status_code == 200
        assert r.get_json()["ok"] is True

    def test_returns_404_for_missing(self, client):
        with patch("api.configs.delete_vpn_config", return_value=False):
            r = client.delete("/api/configs/999")
        assert r.status_code == 404
        assert "not found" in r.get_json()["error"].lower()


# ─── POST /api/configs/<id>/deploy ──────────────────────────────────────────

class TestDeployMule:
    BASE_CONFIG = {
        "id": 1,
        "name": "my-vpn",
        "filename": "wg0.conf",
        "content": b"[Interface]\n",
        "vpn_type": "wireguard",
        "requires_auth": False,
        "ovpn_username": None,
        "ovpn_password": None,
    }

    def test_returns_404_for_missing_config(self, client):
        with patch("api.configs.get_vpn_config", return_value=None):
            r = client.post("/api/configs/999/deploy")
        assert r.status_code == 404

    def test_returns_400_for_openvpn_missing_creds(self, client):
        config = {**self.BASE_CONFIG, "vpn_type": "openvpn", "requires_auth": True,
                  "ovpn_username": None, "ovpn_password": None}
        with patch("api.configs.get_vpn_config", return_value=config):
            r = client.post("/api/configs/1/deploy")
        assert r.status_code == 400
        assert "credentials" in r.get_json()["error"].lower()

    def test_deploys_wireguard_successfully(self, client, tmp_path):
        mule = make_mule()
        with patch.dict("os.environ", {"SMG_HOST_ROOT": str(tmp_path)}), \
             patch("api.configs.get_vpn_config", return_value=self.BASE_CONFIG), \
             patch("api.configs.get_docker_client"), \
             patch("api.configs.read_settings", return_value={}), \
             patch("api.configs.start_mule", return_value=mule), \
             patch("api.configs.wait_for_vpn", return_value=IP_INFO), \
             patch("api.configs.apply_settings_to_mule"), \
             patch("api.configs.stop_mule"):
            r = client.post("/api/configs/1/deploy")
        assert r.status_code == 201
        body = r.get_json()
        assert body["name"] == "smuggler-mule-test"
        assert body["ip_info"]["ip"] == "1.2.3.4"

    def test_returns_502_when_vpn_fails(self, client, tmp_path):
        mule = make_mule()
        with patch.dict("os.environ", {"SMG_HOST_ROOT": str(tmp_path)}), \
             patch("api.configs.get_vpn_config", return_value=self.BASE_CONFIG), \
             patch("api.configs.get_docker_client"), \
             patch("api.configs.read_settings", return_value={}), \
             patch("api.configs.start_mule", return_value=mule), \
             patch("api.configs.wait_for_vpn", side_effect=RuntimeError("VPN timed out")), \
             patch("api.configs.stop_mule") as mock_stop:
            r = client.post("/api/configs/1/deploy")
        assert r.status_code == 502
        assert "VPN timed out" in r.get_json()["error"]
        mock_stop.assert_called_once()

    def test_returns_500_on_docker_error(self, client, tmp_path):
        with patch.dict("os.environ", {"SMG_HOST_ROOT": str(tmp_path)}), \
             patch("api.configs.get_vpn_config", return_value=self.BASE_CONFIG), \
             patch("api.configs.get_docker_client"), \
             patch("api.configs.read_settings", return_value={}), \
             patch("api.configs.start_mule", side_effect=RuntimeError("Docker down")):
            r = client.post("/api/configs/1/deploy")
        assert r.status_code == 500

    def test_deploys_openvpn_with_creds(self, client, tmp_path):
        config = {**self.BASE_CONFIG, "vpn_type": "openvpn", "requires_auth": True,
                  "ovpn_username": "user", "ovpn_password": "pass",
                  "filename": "vpn.ovpn"}
        mule = make_mule()
        with patch.dict("os.environ", {"SMG_HOST_ROOT": str(tmp_path)}), \
             patch("api.configs.get_vpn_config", return_value=config), \
             patch("api.configs.get_docker_client"), \
             patch("api.configs.read_settings", return_value={}), \
             patch("api.configs.start_mule", return_value=mule), \
             patch("api.configs.wait_for_vpn", return_value=IP_INFO), \
             patch("api.configs.apply_settings_to_mule"), \
             patch("api.configs.stop_mule"):
            r = client.post("/api/configs/1/deploy")
        assert r.status_code == 201
