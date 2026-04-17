"""Integration tests for /api/settings endpoints."""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from api.app import create_app

STORED_SETTINGS = {
    "download_dir": "/downloads",
    "max_concurrent_downloads": "5",
    "max_download_speed": "0",
    "max_upload_speed": "0",
}


@pytest.fixture
def app():
    a = create_app()
    a.config["TESTING"] = True
    return a


@pytest.fixture
def client(app):
    return app.test_client()


# ─── GET /api/settings/ ─────────────────────────────────────────────────────

class TestGetSettings:
    def test_returns_all_settings(self, client):
        with patch("api.settings.get_all_settings", return_value=STORED_SETTINGS):
            r = client.get("/api/settings/")
        assert r.status_code == 200
        data = r.get_json()
        assert data["max_concurrent_downloads"] == "5"
        assert data["download_dir"] == "/downloads"


# ─── POST /api/settings/ ────────────────────────────────────────────────────

class TestSaveSettings:
    def test_updates_settings_successfully(self, client):
        updated = {**STORED_SETTINGS, "max_concurrent_downloads": "3"}
        with patch("api.settings.update_settings", return_value=updated), \
             patch("api.settings.sync_all_mules"):
            r = client.post("/api/settings/", json={"max_concurrent_downloads": "3"})
        assert r.status_code == 200
        assert r.get_json()["ok"] is True
        assert r.get_json()["settings"]["max_concurrent_downloads"] == "3"

    def test_calls_sync_after_update(self, client):
        with patch("api.settings.update_settings", return_value=STORED_SETTINGS), \
             patch("api.settings.sync_all_mules") as mock_sync:
            client.post("/api/settings/", json={"max_upload_speed": "1048576"})
        mock_sync.assert_called_once()

    def test_accepts_empty_body(self, client):
        with patch("api.settings.update_settings", return_value=STORED_SETTINGS), \
             patch("api.settings.sync_all_mules"):
            r = client.post("/api/settings/", json={})
        assert r.status_code == 200

    def test_rejects_relative_download_dir(self, client):
        r = client.post("/api/settings/", json={"download_dir": "relative/path"})
        assert r.status_code == 400
        assert "absolute" in r.get_json()["error"].lower()

    def test_rejects_path_traversal(self, client):
        r = client.post("/api/settings/", json={"download_dir": "/downloads/../etc"})
        assert r.status_code == 400

    def test_rejects_path_with_null_byte(self, client):
        r = client.post("/api/settings/", json={"download_dir": "/downloads/\x00evil"})
        assert r.status_code == 400

    def test_returns_403_when_mkdir_fails(self, client):
        with patch("api.settings.os.path.exists", return_value=False), \
             patch("api.settings.os.makedirs", side_effect=OSError("Permission denied")):
            r = client.post("/api/settings/", json={"download_dir": "/restricted/path"})
        assert r.status_code == 403

    def test_returns_403_when_dir_not_writable(self, client):
        with patch("api.settings.os.path.exists", return_value=True), \
             patch("api.settings.os.access", return_value=False):
            r = client.post("/api/settings/", json={"download_dir": "/read-only-dir"})
        assert r.status_code == 403

    def test_accepts_valid_existing_download_dir(self, client, tmp_path):
        dl_dir = str(tmp_path)
        updated = {**STORED_SETTINGS, "download_dir": dl_dir}
        with patch("api.settings.update_settings", return_value=updated), \
             patch("api.settings.sync_all_mules"):
            r = client.post("/api/settings/", json={"download_dir": dl_dir})
        assert r.status_code == 200
