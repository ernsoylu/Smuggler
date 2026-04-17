"""Tests for api/settings_sync module."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from api.settings_sync import apply_settings_to_mule, sync_all_mules


def make_mule_info(name="smuggler-mule-test", status="running"):
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


SETTINGS = {
    "max_concurrent_downloads": "3",
    "max_download_speed": "1048576",
    "max_upload_speed": "524288",
}


# ─── apply_settings_to_mule ─────────────────────────────────────────────────

class TestApplySettingsToMule:
    def test_returns_false_when_mule_not_found(self):
        with patch("api.settings_sync.get_docker_client"), \
             patch("api.settings_sync.get_mule",
                   side_effect=RuntimeError("Mule not found")):
            result = apply_settings_to_mule("ghost-mule", SETTINGS)
        assert result is False

    def test_returns_false_when_mule_not_running(self):
        mule = make_mule_info(status="exited")
        with patch("api.settings_sync.get_docker_client"), \
             patch("api.settings_sync.get_mule", return_value=mule):
            result = apply_settings_to_mule("smuggler-mule-test", SETTINGS)
        assert result is False

    def test_returns_true_on_successful_sync(self):
        mule = make_mule_info(status="running")
        mock_aria2 = MagicMock()
        with patch("api.settings_sync.get_docker_client"), \
             patch("api.settings_sync.get_mule", return_value=mule), \
             patch("api.settings_sync.Aria2Client", return_value=mock_aria2):
            result = apply_settings_to_mule("smuggler-mule-test", SETTINGS)
        assert result is True
        mock_aria2.change_global_option.assert_called_once()

    def test_calls_with_correct_aria2_options(self):
        mule = make_mule_info(status="running")
        mock_aria2 = MagicMock()
        settings = {
            "max_concurrent_downloads": "5",
            "max_download_speed": "0",
            "max_upload_speed": "0",
        }
        with patch("api.settings_sync.get_docker_client"), \
             patch("api.settings_sync.get_mule", return_value=mule), \
             patch("api.settings_sync.Aria2Client", return_value=mock_aria2):
            apply_settings_to_mule("smuggler-mule-test", settings)
        called_opts = mock_aria2.change_global_option.call_args[0][0]
        assert called_opts["max-concurrent-downloads"] == "5"
        assert called_opts["max-overall-download-limit"] == "0"

    def test_returns_false_on_aria2_error(self):
        from cli.aria2_client import Aria2Error
        mule = make_mule_info(status="running")
        mock_aria2 = MagicMock()
        mock_aria2.change_global_option.side_effect = Aria2Error("RPC error")
        with patch("api.settings_sync.get_docker_client"), \
             patch("api.settings_sync.get_mule", return_value=mule), \
             patch("api.settings_sync.Aria2Client", return_value=mock_aria2):
            result = apply_settings_to_mule("smuggler-mule-test", SETTINGS)
        assert result is False

    def test_fetches_settings_when_not_provided(self):
        mule = make_mule_info(status="running")
        mock_aria2 = MagicMock()
        with patch("api.settings_sync.get_docker_client"), \
             patch("api.settings_sync.get_mule", return_value=mule), \
             patch("api.settings_sync.Aria2Client", return_value=mock_aria2), \
             patch("api.settings_sync.get_all_settings", return_value=SETTINGS) as mock_get:
            apply_settings_to_mule("smuggler-mule-test")
        mock_get.assert_called_once()


# ─── sync_all_mules ──────────────────────────────────────────────────────────

class TestSyncAllMules:
    def test_skips_non_running_mules(self):
        running = make_mule_info("mule-a", status="running")
        stopped = make_mule_info("mule-b", status="exited")
        mock_aria2 = MagicMock()
        with patch("api.settings_sync.get_docker_client"), \
             patch("api.settings_sync.list_mules", return_value=[running, stopped]), \
             patch("api.settings_sync.get_all_settings", return_value=SETTINGS), \
             patch("api.settings_sync.get_mule", return_value=running), \
             patch("api.settings_sync.Aria2Client", return_value=mock_aria2):
            sync_all_mules()
        assert mock_aria2.change_global_option.call_count == 1

    def test_handles_empty_mule_list(self):
        with patch("api.settings_sync.get_docker_client"), \
             patch("api.settings_sync.list_mules", return_value=[]), \
             patch("api.settings_sync.get_all_settings", return_value=SETTINGS):
            sync_all_mules()  # should not raise

    def test_syncs_all_running_mules(self):
        mules = [make_mule_info(f"mule-{i}", status="running") for i in range(3)]
        mock_aria2 = MagicMock()
        with patch("api.settings_sync.get_docker_client"), \
             patch("api.settings_sync.list_mules", return_value=mules), \
             patch("api.settings_sync.get_all_settings", return_value=SETTINGS), \
             patch("api.settings_sync.get_mule", side_effect=mules), \
             patch("api.settings_sync.Aria2Client", return_value=mock_aria2):
            sync_all_mules()
        assert mock_aria2.change_global_option.call_count == 3
