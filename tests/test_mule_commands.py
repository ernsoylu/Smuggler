"""Integration-style tests for CLI mule commands (no real Docker)."""

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
    with patch("cli.mule_commands.get_docker_client", return_value=mock_client), \
         patch("cli.docker_client.get_docker_client", return_value=mock_client):
        yield mock_client


def make_container(
    name="smuggler-mule-test",
    status="running",
    rpc_port=16800,
    token="tok",
):
    c = MagicMock()
    c.name = name
    c.short_id = "abc"
    c.status = status
    c.labels = {
        "smuggler.mule": "true",
        "smuggler.rpc_token": token,
        "smuggler.rpc_port": str(rpc_port),
        "smuggler.vpn_config": "vpn.conf",
    }
    return c


# ─── smg mule start ────────────────────────────────────────────────────────────

VPN_INFO = {"ip": "1.2.3.4", "country": "NZ", "city": "Auckland", "region": "Auckland", "org": "AS1234 Mega"}


class TestWorkerStart:
    def test_start_confirms_vpn_and_prints_ip(self, runner, mock_docker):
        container = make_container()
        mock_docker.containers.run.return_value = container

        with tempfile.NamedTemporaryFile(suffix=".conf", delete=False) as f:
            f.write(b"[Interface]\n")
            conf = f.name

        try:
            with patch("cli.docker_client._find_free_port", return_value=16800), \
                 patch("cli.mule_commands.wait_for_vpn", return_value=VPN_INFO):
                result = runner.invoke(cli, ["mule", "start", "--config", conf])
        finally:
            os.unlink(conf)

        assert result.exit_code == 0
        assert "smuggler-mule-test" in result.output
        assert "1.2.3.4" in result.output
        assert "NZ" in result.output

    def test_start_fails_with_missing_config(self, runner, mock_docker):
        result = runner.invoke(cli, ["mule", "start", "--config", "/no/such/file.conf"])
        assert result.exit_code != 0

    def test_start_fails_when_image_missing(self, runner, mock_docker):
        import docker.errors
        mock_docker.containers.run.side_effect = docker.errors.ImageNotFound("nope")

        with tempfile.NamedTemporaryFile(suffix=".conf", delete=False) as f:
            f.write(b"[Interface]\n")
            conf = f.name

        try:
            result = runner.invoke(cli, ["mule", "start", "--config", conf])
        finally:
            os.unlink(conf)

        assert result.exit_code != 0
        assert "smg build" in result.output.lower() or "not found" in result.output.lower()

    def test_start_stops_container_when_vpn_fails(self, runner, mock_docker):
        container = make_container()
        mock_docker.containers.run.return_value = container
        mock_docker.containers.get.return_value = container

        with tempfile.NamedTemporaryFile(suffix=".conf", delete=False) as f:
            f.write(b"[Interface]\n")
            conf = f.name

        try:
            with patch("cli.docker_client._find_free_port", return_value=16800), \
                 patch("cli.mule_commands.wait_for_vpn",
                       side_effect=RuntimeError("VPN confirmation timed out")), \
                 patch("cli.mule_commands.stop_mule") as mock_stop:
                result = runner.invoke(cli, ["mule", "start", "--config", conf])
        finally:
            os.unlink(conf)

        assert result.exit_code != 0
        assert "VPN failed" in result.output or "timed out" in result.output
        mock_stop.assert_called_once()


# ─── smg mule list ─────────────────────────────────────────────────────────────

class TestWorkerList:
    def test_list_shows_running_workers(self, runner, mock_docker):
        containers = [make_container("smuggler-mule-a"), make_container("smuggler-mule-b", status="exited")]
        mock_docker.containers.list.return_value = containers
        result = runner.invoke(cli, ["mule", "list"])
        assert result.exit_code == 0
        assert "smuggler-mule-a" in result.output
        assert "smuggler-mule-b" in result.output
        assert "running" in result.output

    def test_list_shows_empty_message(self, runner, mock_docker):
        mock_docker.containers.list.return_value = []
        result = runner.invoke(cli, ["mule", "list"])
        assert result.exit_code == 0
        assert "No mules" in result.output


# ─── smg mule stop ─────────────────────────────────────────────────────────────

class TestWorkerStop:
    def test_stop_removes_container(self, runner, mock_docker):
        container = make_container()
        mock_docker.containers.get.return_value = container
        result = runner.invoke(cli, ["mule", "stop", "smuggler-mule-test"])
        assert result.exit_code == 0
        container.stop.assert_called_once()
        container.remove.assert_called_once()
        assert "stopped and removed" in result.output

    def test_stop_keep_flag(self, runner, mock_docker):
        container = make_container()
        mock_docker.containers.get.return_value = container
        result = runner.invoke(cli, ["mule", "stop", "--keep", "smuggler-mule-test"])
        assert result.exit_code == 0
        container.stop.assert_called_once()
        container.remove.assert_not_called()

    def test_stop_nonexistent_worker(self, runner, mock_docker):
        import docker.errors
        mock_docker.containers.get.side_effect = docker.errors.NotFound("no")
        result = runner.invoke(cli, ["mule", "stop", "ghost"])
        assert result.exit_code != 0
        assert "not found" in result.output.lower()


# ─── smg mule ip ───────────────────────────────────────────────────────────────

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

        result = runner.invoke(cli, ["mule", "ip", "smuggler-mule-test", "--wait", "5"])
        assert result.exit_code == 0
        assert "1.2.3.4" in result.output
        assert "TestCity" in result.output
        assert "TC" in result.output

    def test_shows_error_on_exec_failure(self, runner, mock_docker):
        import docker.errors
        mock_docker.containers.get.side_effect = docker.errors.NotFound("no")
        result = runner.invoke(cli, ["mule", "ip", "ghost", "--wait", "1"])
        assert result.exit_code != 0


# ─── smg mule kill ─────────────────────────────────────────────────────────────

class TestWorkerKill:
    def test_kill_individual_worker(self, runner, mock_docker):
        container = make_container()
        mock_docker.containers.get.return_value = container
        result = runner.invoke(cli, ["mule", "kill", "smuggler-mule-test"])
        assert result.exit_code == 0
        container.kill.assert_called_once()
        container.remove.assert_called_once()
        assert "killed and removed" in result.output

    def test_kill_individual_keep_flag(self, runner, mock_docker):
        container = make_container()
        mock_docker.containers.get.return_value = container
        result = runner.invoke(cli, ["mule", "kill", "--keep", "smuggler-mule-test"])
        assert result.exit_code == 0
        container.kill.assert_called_once()
        container.remove.assert_not_called()

    def test_kill_all_with_yes_flag(self, runner, mock_docker):
        containers = [make_container("smuggler-mule-aaa"), make_container("smuggler-mule-bbb")]
        mock_docker.containers.list.return_value = containers
        mock_docker.containers.get.side_effect = containers
        result = runner.invoke(cli, ["mule", "kill", "--all", "--yes"])
        assert result.exit_code == 0
        assert "2" in result.output
        for c in containers:
            c.kill.assert_called_once()

    def test_kill_all_prompts_without_yes(self, runner, mock_docker):
        containers = [make_container("smuggler-mule-aaa")]
        mock_docker.containers.list.return_value = containers
        mock_docker.containers.get.side_effect = containers
        result = runner.invoke(cli, ["mule", "kill", "--all"], input="y\n")
        assert result.exit_code == 0
        assert "killed" in result.output

    def test_kill_all_aborts_on_no(self, runner, mock_docker):
        containers = [make_container("smuggler-mule-aaa")]
        mock_docker.containers.list.return_value = containers
        result = runner.invoke(cli, ["mule", "kill", "--all"], input="n\n")
        assert result.exit_code != 0

    def test_kill_all_empty(self, runner, mock_docker):
        mock_docker.containers.list.return_value = []
        result = runner.invoke(cli, ["mule", "kill", "--all", "--yes"])
        assert result.exit_code == 0
        assert "No mules" in result.output

    def test_kill_requires_name_or_all(self, runner, mock_docker):
        result = runner.invoke(cli, ["mule", "kill"])
        assert result.exit_code != 0
        assert "mule name or --all" in result.output

    def test_kill_rejects_name_and_all_together(self, runner, mock_docker):
        result = runner.invoke(cli, ["mule", "kill", "--all", "smuggler-mule-test"])
        assert result.exit_code != 0

    def test_kill_nonexistent_worker(self, runner, mock_docker):
        import docker.errors
        mock_docker.containers.get.side_effect = docker.errors.NotFound("no")
        result = runner.invoke(cli, ["mule", "kill", "ghost"])
        assert result.exit_code != 0
        assert "not found" in result.output.lower()
