"""Unit tests for api/database module using a temporary SQLite database."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest

import api.database as db


@pytest.fixture(autouse=True)
def temp_db(tmp_path):
    """Patch DB_PATH to a fresh temp file for every test."""
    db_file = tmp_path / "test_smuggler.db"
    with patch.object(db, "DB_PATH", db_file):
        db.init_db()
        yield db_file


# ─── init_db ────────────────────────────────────────────────────────────────

class TestInitDb:
    def test_creates_settings_table(self):
        conn = sqlite3.connect(str(db.DB_PATH))
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
        conn.close()
        assert "settings" in tables

    def test_creates_vpn_configs_table(self):
        conn = sqlite3.connect(str(db.DB_PATH))
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
        conn.close()
        assert "vpn_configs" in tables

    def test_seeds_default_settings(self):
        settings = db.get_all_settings()
        assert "max_concurrent_downloads" in settings
        assert "download_dir" in settings

    def test_idempotent(self):
        db.init_db()  # second call should not raise
        settings = db.get_all_settings()
        assert settings["max_concurrent_downloads"] == "5"


# ─── get_all_settings ───────────────────────────────────────────────────────

class TestGetAllSettings:
    def test_returns_all_defaults(self):
        settings = db.get_all_settings()
        for key in db._DEFAULTS:
            assert key in settings

    def test_fills_in_missing_defaults(self):
        conn = sqlite3.connect(str(db.DB_PATH))
        conn.execute("DELETE FROM settings WHERE key = 'max_upload_speed'")
        conn.commit()
        conn.close()
        settings = db.get_all_settings()
        assert settings["max_upload_speed"] == db._DEFAULTS["max_upload_speed"]

    def test_reflects_stored_overrides(self):
        db.set_setting("max_concurrent_downloads", "10")
        settings = db.get_all_settings()
        assert settings["max_concurrent_downloads"] == "10"


# ─── get_setting ────────────────────────────────────────────────────────────

class TestGetSetting:
    def test_returns_stored_value(self):
        db.set_setting("max_download_speed", "2097152")
        assert db.get_setting("max_download_speed") == "2097152"

    def test_returns_default_for_missing_key(self):
        result = db.get_setting("max_upload_speed")
        assert result == db._DEFAULTS["max_upload_speed"]

    def test_returns_empty_string_for_unknown_key(self):
        result = db.get_setting("nonexistent_key")
        assert result == ""


# ─── set_setting ────────────────────────────────────────────────────────────

class TestSetSetting:
    def test_inserts_new_setting(self):
        db.set_setting("custom_key", "custom_value")
        assert db.get_setting("custom_key") == "custom_value"

    def test_updates_existing_setting(self):
        db.set_setting("max_concurrent_downloads", "3")
        db.set_setting("max_concurrent_downloads", "7")
        assert db.get_setting("max_concurrent_downloads") == "7"


# ─── update_settings ────────────────────────────────────────────────────────

class TestUpdateSettings:
    def test_updates_multiple_settings(self):
        result = db.update_settings({
            "max_concurrent_downloads": "8",
            "max_download_speed": "1048576",
        })
        assert result["max_concurrent_downloads"] == "8"
        assert result["max_download_speed"] == "1048576"

    def test_returns_merged_settings(self):
        result = db.update_settings({"max_upload_speed": "512000"})
        assert "download_dir" in result
        assert result["max_upload_speed"] == "512000"

    def test_coerces_values_to_str(self):
        result = db.update_settings({"max_concurrent_downloads": 4})
        assert result["max_concurrent_downloads"] == "4"


# ─── list_vpn_configs ───────────────────────────────────────────────────────

class TestListVpnConfigs:
    def test_returns_empty_list_initially(self):
        assert db.list_vpn_configs() == []

    def test_returns_inserted_configs(self):
        db.add_vpn_config("vpn1", "wg0.conf", b"[Interface]\n", "wireguard")
        db.add_vpn_config("vpn2", "vpn2.ovpn", b"client\n", "openvpn", True)
        configs = db.list_vpn_configs()
        assert len(configs) == 2
        names = {c["name"] for c in configs}
        assert "vpn1" in names and "vpn2" in names

    def test_does_not_include_content(self):
        db.add_vpn_config("vpn1", "wg0.conf", b"[Interface]\n")
        configs = db.list_vpn_configs()
        assert "content" not in configs[0]

    def test_requires_auth_is_boolean(self):
        db.add_vpn_config("vpn", "vpn.ovpn", b"", "openvpn", True)
        configs = db.list_vpn_configs()
        assert configs[0]["requires_auth"] is True

    def test_defaults_vpn_type_to_wireguard_for_empty_string(self):
        conn = sqlite3.connect(str(db.DB_PATH))
        conn.execute(
            "INSERT INTO vpn_configs (name, filename, content, vpn_type, requires_auth) "
            "VALUES (?, ?, ?, ?, 0)", ("vpn", "wg0.conf", b"", "")
        )
        conn.commit()
        conn.close()
        configs = db.list_vpn_configs()
        assert configs[0]["vpn_type"] == "wireguard"


# ─── get_vpn_config ─────────────────────────────────────────────────────────

class TestGetVpnConfig:
    def test_returns_none_for_missing_id(self):
        assert db.get_vpn_config(9999) is None

    def test_returns_config_with_content(self):
        config_id = db.add_vpn_config("myvpn", "wg0.conf", b"[Interface]\nkey=val\n")
        config = db.get_vpn_config(config_id)
        assert config is not None
        assert config["name"] == "myvpn"
        assert config["content"] == b"[Interface]\nkey=val\n"

    def test_returns_openvpn_with_credentials(self):
        config_id = db.add_vpn_config(
            "ovpn", "vpn.ovpn", b"client\n", "openvpn", True, "user", "pass"
        )
        config = db.get_vpn_config(config_id)
        assert config["ovpn_username"] == "user"
        assert config["ovpn_password"] == "pass"
        assert config["requires_auth"] is True


# ─── add_vpn_config ─────────────────────────────────────────────────────────

class TestAddVpnConfig:
    def test_returns_auto_incremented_id(self):
        id1 = db.add_vpn_config("vpn1", "wg0.conf", b"")
        id2 = db.add_vpn_config("vpn2", "wg1.conf", b"")
        assert id2 > id1

    def test_stores_all_fields(self):
        config_id = db.add_vpn_config(
            "test-vpn", "test.ovpn", b"content", "openvpn", True, "u", "p"
        )
        config = db.get_vpn_config(config_id)
        assert config["filename"] == "test.ovpn"
        assert config["vpn_type"] == "openvpn"
        assert config["ovpn_username"] == "u"


# ─── delete_vpn_config ──────────────────────────────────────────────────────

class TestDeleteVpnConfig:
    def test_deletes_existing_config(self):
        config_id = db.add_vpn_config("vpn", "wg0.conf", b"")
        assert db.delete_vpn_config(config_id) is True
        assert db.get_vpn_config(config_id) is None

    def test_returns_false_for_missing_id(self):
        assert db.delete_vpn_config(9999) is False

    def test_only_deletes_target(self):
        id1 = db.add_vpn_config("vpn1", "wg0.conf", b"")
        id2 = db.add_vpn_config("vpn2", "wg1.conf", b"")
        db.delete_vpn_config(id1)
        assert db.get_vpn_config(id2) is not None
