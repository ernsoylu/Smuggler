"""Integration-style tests for CLI worker commands (no real Docker)."""

from __future__ import annotations

import json
import tempfile
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner

from cli.main import cli


@pytest.fixture
def runner():
    return CliRunner()


@pytest.fixture
def mock_docker():
    """Patch get_docker_client everywhere it is imported."""
    mock_client = MagicMock()
    mock_client.ping.return_value = True
    with patch("cli.worker_commands.get_docker_client", return_value=mock_client), \
         patch("cli.docker_client.get_docker_client", return_value=mock_client):
        yield mock_client


def make_container(
    name="dvd-worker-test",
    status="running",
    rpc_port=16800,
    token="tok",
):
    c = MagicMock()
    c.name = name
    c.short_id = "abc"
    c.status = status
    c.labels = {
        "dvd.worker": "true",
        "dvd.rpc_token": token,
        "dvd.rpc_port": str(rpc_port),
        "dvd.vpn_config": "vpn.conf",
    }
    return c


# ─── dvd worker start ────────────────────────────────────────────────────────

class TestWorkerStart:
    def test_start_prints_worker_info(self, runner, mock_docker):
        container = make_container()
        mock_docker.containers.run.return_value = container

        with tempfile.NamedTemporaryFile(suffix=".conf", delete=False) as f:
            f.write(b"[Interface]\n")
            conf = f.name

        try:
            with patch("cli.docker_client._find_free_port", return_value=16800):
                result = runner.invoke(cli, ["worker", "start", "--config", conf])
        finally:
            os.unlink(conf)

        assert result.exit_code == 0
        assert "dvd-worker-test" in result.output

    def test_start_fails_with_missing_config(self, runner, mock_docker):
        result = runner.invoke(cli, ["worker", "start", "--config", "/no/such/file.conf"])
        assert result.exit_code != 0

    def test_start_fails_when_image_missing(self, runner, mock_docker):
        import docker.errors
        mock_docker.containers.run.side_effect = docker.errors.ImageNotFound("nope")

        with tempfile.NamedTemporaryFile(suffix=".conf", delete=False) as f:
            f.write(b"[Interface]\n")
            conf = f.name

        try:
            result = runner.invoke(cli, ["worker", "start", "--config", conf])
        finally:
            os.unlink(conf)

        assert result.exit_code != 0
        assert "dvd build" in result.output.lower() or "not found" in result.output.lower()


# ─── dvd worker list ─────────────────────────────────────────────────────────

class TestWorkerList:
    def test_list_shows_running_workers(self, runner, mock_docker):
        containers = [make_container("dvd-worker-a"), make_container("dvd-worker-b", status="exited")]
        mock_docker.containers.list.return_value = containers
        result = runner.invoke(cli, ["worker", "list"])
        assert result.exit_code == 0
        assert "dvd-worker-a" in result.output
        assert "dvd-worker-b" in result.output
        assert "running" in result.output

    def test_list_shows_empty_message(self, runner, mock_docker):
        mock_docker.containers.list.return_value = []
        result = runner.invoke(cli, ["worker", "list"])
        assert result.exit_code == 0
        assert "No workers" in result.output


# ─── dvd worker stop ─────────────────────────────────────────────────────────

class TestWorkerStop:
    def test_stop_removes_container(self, runner, mock_docker):
        container = make_container()
        mock_docker.containers.get.return_value = container
        result = runner.invoke(cli, ["worker", "stop", "dvd-worker-test"])
        assert result.exit_code == 0
        container.stop.assert_called_once()
        container.remove.assert_called_once()
        assert "stopped and removed" in result.output

    def test_stop_keep_flag(self, runner, mock_docker):
        container = make_container()
        mock_docker.containers.get.return_value = container
        result = runner.invoke(cli, ["worker", "stop", "--keep", "dvd-worker-test"])
        assert result.exit_code == 0
        container.stop.assert_called_once()
        container.remove.assert_not_called()

    def test_stop_nonexistent_worker(self, runner, mock_docker):
        import docker.errors
        mock_docker.containers.get.side_effect = docker.errors.NotFound("no")
        result = runner.invoke(cli, ["worker", "stop", "ghost"])
        assert result.exit_code != 0
        assert "not found" in result.output.lower()


# ─── dvd worker ip ───────────────────────────────────────────────────────────

class TestWorkerIp:
    def test_shows_ip_info(self, runner, mock_docker):
        container = make_container()
        mock_docker.containers.get.return_value = container
        ip_json = json.dumps({
            "ip": "1.2.3.4",
            "city": "TestCity",
            "region": "TestRegion",
            "country": "TC",
            "org": "AS1234 TestOrg",
        })
        container.exec_run.return_value = (0, ip_json.encode())

        result = runner.invoke(cli, ["worker", "ip", "dvd-worker-test", "--wait", "5"])
        assert result.exit_code == 0
        assert "1.2.3.4" in result.output
        assert "TestCity" in result.output
        assert "TC" in result.output

    def test_shows_error_on_exec_failure(self, runner, mock_docker):
        import docker.errors
        mock_docker.containers.get.side_effect = docker.errors.NotFound("no")
        result = runner.invoke(cli, ["worker", "ip", "ghost", "--wait", "1"])
        assert result.exit_code != 0
