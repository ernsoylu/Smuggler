"""Integration-style tests for CLI torrent commands."""

from __future__ import annotations

import tempfile
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import responses as resp_lib
from click.testing import CliRunner

from cli.main import cli

BASE_URL = "http://localhost:16800/jsonrpc"


@pytest.fixture
def runner():
    return CliRunner()


def make_container(name="smuggler-mule-test", status="running"):
    c = MagicMock()
    c.name = name
    c.short_id = "abc"
    c.status = status
    c.labels = {
        "smuggler.mule": "true",
        "smuggler.rpc_token": "tok",
        "smuggler.rpc_port": "16800",
        "smuggler.vpn_config": "vpn.conf",
    }
    return c


def rpc_ok(result):
    return {"jsonrpc": "2.0", "id": "dvd", "result": result}


def rpc_err(msg):
    return {"jsonrpc": "2.0", "id": "dvd", "error": {"code": -1, "message": msg}}


@pytest.fixture
def mock_mule_docker():
    container = make_container()
    mock_client = MagicMock()
    mock_client.ping.return_value = True
    mock_client.containers.get.return_value = container
    mock_client.containers.list.return_value = [container]
    with patch("cli.torrent_commands.get_docker_client", return_value=mock_client), \
         patch("cli.torrent_commands.get_mule") as mock_get_mule:
        from cli.docker_client import MuleInfo
        mule_info = MuleInfo(container)
        mock_get_mule.return_value = mule_info
        yield mock_client, mock_get_mule


# ─── smg torrent add ─────────────────────────────────────────────────────────

class TestTorrentAdd:
    @resp_lib.activate
    def test_add_magnet_success(self, runner, mock_mule_docker):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_ok("gid1234"))
        result = runner.invoke(
            cli,
            ["torrent", "add", "smuggler-mule-test", "--magnet", "magnet:?xt=urn:btih:abc"],
        )
        assert result.exit_code == 0
        assert "gid1234" in result.output
        assert "Torrent added" in result.output

    @resp_lib.activate
    def test_add_torrent_file_success(self, runner, mock_mule_docker):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_ok("gid5678"))
        with tempfile.NamedTemporaryFile(suffix=".torrent", delete=False) as f:
            f.write(b"d8:announcee")
            path = f.name
        try:
            result = runner.invoke(
                cli, ["torrent", "add", "smuggler-mule-test", "--file", path]
            )
            assert result.exit_code == 0
            assert "gid5678" in result.output
        finally:
            os.unlink(path)

    def test_add_requires_magnet_or_file(self, runner, mock_mule_docker):
        result = runner.invoke(cli, ["torrent", "add", "smuggler-mule-test"])
        assert result.exit_code != 0
        assert "--magnet" in result.output or "Provide" in result.output

    def test_add_rejects_both_magnet_and_file(self, runner, mock_mule_docker):
        with tempfile.NamedTemporaryFile(suffix=".torrent", delete=False) as f:
            f.write(b"d")
            path = f.name
        try:
            result = runner.invoke(
                cli,
                [
                    "torrent", "add", "smuggler-mule-test",
                    "--magnet", "magnet:?xt=test",
                    "--file", path,
                ],
            )
            assert result.exit_code != 0
            assert "not both" in result.output
        finally:
            os.unlink(path)

    @resp_lib.activate
    def test_add_shows_aria2_error(self, runner, mock_mule_docker):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_err("Invalid URI"))
        result = runner.invoke(
            cli,
            ["torrent", "add", "smuggler-mule-test", "--magnet", "magnet:?bad"],
        )
        assert result.exit_code != 0
        assert "Invalid URI" in result.output


# ─── smg torrent list ────────────────────────────────────────────────────────

class TestTorrentList:
    @resp_lib.activate
    def test_list_shows_active_torrents(self, runner, mock_mule_docker):
        active = [
            {
                "gid": "aaa",
                "status": "active",
                "completedLength": "500",
                "totalLength": "1000",
                "downloadSpeed": "2048",
                "bittorrent": {"info": {"name": "MyMovie"}},
                "files": [],
            }
        ]
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_ok(active))   # tellActive
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_ok([]))        # tellWaiting
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_ok([]))        # tellStopped

        result = runner.invoke(cli, ["torrent", "list", "smuggler-mule-test"])
        assert result.exit_code == 0
        assert "MyMovie" in result.output
        assert "aaa" in result.output

    @resp_lib.activate
    def test_list_shows_no_torrents_message(self, runner, mock_mule_docker):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_ok([]))   # tellActive
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_ok([]))   # tellWaiting
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_ok([]))   # tellStopped

        result = runner.invoke(cli, ["torrent", "list", "smuggler-mule-test"])
        assert result.exit_code == 0
        assert "no torrents" in result.output


# ─── smg torrent remove ──────────────────────────────────────────────────────

class TestTorrentRemove:
    @resp_lib.activate
    def test_remove_success(self, runner, mock_mule_docker):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_ok("aaa"))
        result = runner.invoke(cli, ["torrent", "remove", "smuggler-mule-test", "aaa"])
        assert result.exit_code == 0
        assert "Removed" in result.output
        assert "aaa" in result.output

    @resp_lib.activate
    def test_remove_error(self, runner, mock_mule_docker):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_err("GID not found"))
        result = runner.invoke(cli, ["torrent", "remove", "smuggler-mule-test", "zzz"])
        assert result.exit_code != 0
        assert "GID not found" in result.output


# ─── smg torrent pause / resume ──────────────────────────────────────────────

class TestTorrentPauseResume:
    @resp_lib.activate
    def test_pause_success(self, runner, mock_mule_docker):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_ok("aaa"))
        result = runner.invoke(cli, ["torrent", "pause", "smuggler-mule-test", "aaa"])
        assert result.exit_code == 0
        assert "Paused" in result.output

    @resp_lib.activate
    def test_resume_success(self, runner, mock_mule_docker):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_ok("aaa"))
        result = runner.invoke(cli, ["torrent", "resume", "smuggler-mule-test", "aaa"])
        assert result.exit_code == 0
        assert "Resumed" in result.output
