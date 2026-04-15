"""Unit tests for cli.docker_client."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch, call
import tempfile
import os

import docker.errors
import pytest

from cli.docker_client import (
    WorkerInfo,
    build_image,
    exec_in_worker,
    get_container_logs,
    get_docker_client,
    get_worker,
    kill_all_workers,
    kill_worker,
    list_workers,
    start_worker,
    stop_worker,
    wait_for_vpn,
    WORKER_LABEL,
    WORKER_IMAGE,
)


# ─── get_docker_client ───────────────────────────────────────────────────────

class TestGetDockerClient:
    def test_returns_client_when_daemon_reachable(self):
        mock_client = MagicMock()
        mock_client.ping.return_value = True
        with patch("cli.docker_client.docker.from_env", return_value=mock_client):
            result = get_docker_client()
        assert result is mock_client
        mock_client.ping.assert_called_once()

    def test_raises_runtime_error_when_daemon_unreachable(self):
        with patch(
            "cli.docker_client.docker.from_env",
            side_effect=docker.errors.DockerException("daemon not running"),
        ):
            with pytest.raises(RuntimeError, match="Cannot connect to Docker daemon"):
                get_docker_client()


# ─── WorkerInfo ──────────────────────────────────────────────────────────────

class TestWorkerInfo:
    def test_parses_labels_correctly(self, mock_container):
        info = WorkerInfo(mock_container)
        assert info.name == "dvd-worker-test"
        assert info.id == "abc123"
        assert info.status == "running"
        assert info.rpc_token == "test-token-xyz"
        assert info.rpc_port == 16800
        assert info.vpn_config == "vpn.conf"

    def test_rpc_url_format(self, mock_container):
        info = WorkerInfo(mock_container)
        assert info.rpc_url == "http://localhost:16800/jsonrpc"

    def test_missing_labels_use_defaults(self):
        c = MagicMock()
        c.name = "x"
        c.short_id = "y"
        c.status = "running"
        c.labels = {}
        info = WorkerInfo(c)
        assert info.rpc_port == 0
        assert info.rpc_token == ""


# ─── start_worker ────────────────────────────────────────────────────────────

class TestStartWorker:
    def test_start_worker_success(self, mock_docker_client, mock_container):
        with tempfile.NamedTemporaryFile(suffix=".conf", delete=False) as f:
            f.write(b"[Interface]\nPrivateKey = test\n")
            conf_path = f.name

        try:
            mock_docker_client.containers.run.return_value = mock_container

            with patch("cli.docker_client._find_free_port", return_value=16800):
                worker = start_worker(mock_docker_client, conf_path)

            assert worker.name == "dvd-worker-test"
            call_kwargs = mock_docker_client.containers.run.call_args
            assert call_kwargs.kwargs["image"] == WORKER_IMAGE
            assert "NET_ADMIN" in call_kwargs.kwargs["cap_add"]
            assert "SYS_MODULE" in call_kwargs.kwargs["cap_add"]
            assert WORKER_LABEL in call_kwargs.kwargs["labels"]
            assert call_kwargs.kwargs["restart_policy"] == {"Name": "unless-stopped"}
        finally:
            os.unlink(conf_path)

    def test_start_worker_config_not_found(self, mock_docker_client):
        with pytest.raises(FileNotFoundError, match="VPN config not found"):
            start_worker(mock_docker_client, "/nonexistent/path/wg.conf")

    def test_start_worker_image_not_found(self, mock_docker_client):
        with tempfile.NamedTemporaryFile(suffix=".conf", delete=False) as f:
            f.write(b"[Interface]\n")
            conf_path = f.name

        try:
            mock_docker_client.containers.run.side_effect = docker.errors.ImageNotFound("no image")
            with pytest.raises(RuntimeError, match="Worker image.*not found"):
                start_worker(mock_docker_client, conf_path)
        finally:
            os.unlink(conf_path)

    def test_start_worker_api_error(self, mock_docker_client):
        with tempfile.NamedTemporaryFile(suffix=".conf", delete=False) as f:
            f.write(b"[Interface]\n")
            conf_path = f.name

        try:
            mock_docker_client.containers.run.side_effect = docker.errors.APIError("fail")
            with pytest.raises(RuntimeError, match="Docker API error"):
                start_worker(mock_docker_client, conf_path)
        finally:
            os.unlink(conf_path)

    def test_downloads_dir_is_created(self, mock_docker_client, mock_container):
        with tempfile.TemporaryDirectory() as tmpdir:
            conf_path = Path(tmpdir) / "vpn.conf"
            conf_path.write_text("[Interface]\n")
            downloads_dir = Path(tmpdir) / "my_downloads"
            mock_docker_client.containers.run.return_value = mock_container

            with patch("cli.docker_client._find_free_port", return_value=16800):
                start_worker(mock_docker_client, conf_path, downloads_dir=downloads_dir)

            assert downloads_dir.exists()


# ─── list_workers ────────────────────────────────────────────────────────────

class TestListWorkers:
    def test_returns_worker_info_list(self, mock_docker_client, mock_container):
        mock_docker_client.containers.list.return_value = [mock_container]
        workers = list_workers(mock_docker_client)
        assert len(workers) == 1
        assert workers[0].name == "dvd-worker-test"
        mock_docker_client.containers.list.assert_called_once_with(
            all=True, filters={"label": WORKER_LABEL}
        )

    def test_returns_empty_list_when_no_workers(self, mock_docker_client):
        mock_docker_client.containers.list.return_value = []
        workers = list_workers(mock_docker_client)
        assert workers == []


# ─── get_worker ──────────────────────────────────────────────────────────────

class TestGetWorker:
    def test_found_worker_with_label(self, mock_docker_client, mock_container):
        mock_docker_client.containers.get.return_value = mock_container
        worker = get_worker(mock_docker_client, "dvd-worker-test")
        assert worker.name == "dvd-worker-test"

    def test_raises_when_not_found(self, mock_docker_client):
        mock_docker_client.containers.get.side_effect = docker.errors.NotFound("nope")
        with pytest.raises(RuntimeError, match="Worker not found"):
            get_worker(mock_docker_client, "ghost")

    def test_raises_when_container_is_not_a_worker(self, mock_docker_client):
        c = MagicMock()
        c.labels = {}  # no dvd.worker label
        mock_docker_client.containers.get.return_value = c
        with pytest.raises(RuntimeError, match="not a dvd worker"):
            get_worker(mock_docker_client, "random-container")


# ─── stop_worker ─────────────────────────────────────────────────────────────

class TestStopWorker:
    def test_stop_and_remove(self, mock_docker_client, mock_container):
        mock_docker_client.containers.get.return_value = mock_container
        stop_worker(mock_docker_client, "dvd-worker-test", remove=True)
        mock_container.stop.assert_called_once_with(timeout=10)
        mock_container.remove.assert_called_once()

    def test_stop_without_remove(self, mock_docker_client, mock_container):
        mock_docker_client.containers.get.return_value = mock_container
        stop_worker(mock_docker_client, "dvd-worker-test", remove=False)
        mock_container.stop.assert_called_once()
        mock_container.remove.assert_not_called()

    def test_raises_on_api_error(self, mock_docker_client, mock_container):
        mock_docker_client.containers.get.return_value = mock_container
        mock_container.stop.side_effect = docker.errors.APIError("stop failed")
        with pytest.raises(RuntimeError, match="Failed to stop worker"):
            stop_worker(mock_docker_client, "dvd-worker-test")


# ─── kill_worker ─────────────────────────────────────────────────────────────

class TestKillWorker:
    def test_kills_and_removes_running_container(self, mock_docker_client, mock_container):
        mock_docker_client.containers.get.return_value = mock_container
        kill_worker(mock_docker_client, "dvd-worker-test", remove=True)
        mock_container.kill.assert_called_once()
        mock_container.remove.assert_called_once()

    def test_skips_kill_for_non_running_container(self, mock_docker_client, mock_stopped_container):
        mock_docker_client.containers.get.return_value = mock_stopped_container
        kill_worker(mock_docker_client, "dvd-worker-test", remove=True)
        mock_stopped_container.kill.assert_not_called()
        mock_stopped_container.remove.assert_called_once()

    def test_kill_without_remove(self, mock_docker_client, mock_container):
        mock_docker_client.containers.get.return_value = mock_container
        kill_worker(mock_docker_client, "dvd-worker-test", remove=False)
        mock_container.kill.assert_called_once()
        mock_container.remove.assert_not_called()

    def test_raises_on_api_error(self, mock_docker_client, mock_container):
        mock_docker_client.containers.get.return_value = mock_container
        mock_container.kill.side_effect = docker.errors.APIError("kill failed")
        with pytest.raises(RuntimeError, match="Failed to kill worker"):
            kill_worker(mock_docker_client, "dvd-worker-test")


# ─── kill_all_workers ────────────────────────────────────────────────────────

class TestKillAllWorkers:
    def _make_container(self, name: str):
        c = MagicMock()
        c.name = name
        c.short_id = name[-3:]
        c.status = "running"
        c.labels = {
            "dvd.worker": "true",
            "dvd.rpc_token": "tok",
            "dvd.rpc_port": "16800",
            "dvd.vpn_config": "vpn.conf",
        }
        return c

    def test_kills_all_workers_and_returns_names(self, mock_docker_client):
        containers = [self._make_container("dvd-worker-aaa"), self._make_container("dvd-worker-bbb")]
        mock_docker_client.containers.list.return_value = containers
        mock_docker_client.containers.get.side_effect = containers

        killed = kill_all_workers(mock_docker_client, remove=True)
        assert set(killed) == {"dvd-worker-aaa", "dvd-worker-bbb"}
        for c in containers:
            c.kill.assert_called_once()
            c.remove.assert_called_once()

    def test_returns_empty_list_when_no_workers(self, mock_docker_client):
        mock_docker_client.containers.list.return_value = []
        result = kill_all_workers(mock_docker_client)
        assert result == []

    def test_collects_errors_and_raises_after_all_attempts(self, mock_docker_client):
        c1 = self._make_container("dvd-worker-aaa")
        c2 = self._make_container("dvd-worker-bbb")
        mock_docker_client.containers.list.return_value = [c1, c2]
        # c1 succeeds; c2 fails
        mock_docker_client.containers.get.side_effect = [c1, c2]
        c2.kill.side_effect = docker.errors.APIError("permission denied")

        with pytest.raises(RuntimeError, match="1 error"):
            kill_all_workers(mock_docker_client)

        # c1 must still have been killed despite c2 failing
        c1.kill.assert_called_once()


# ─── exec_in_worker ──────────────────────────────────────────────────────────

class TestExecInWorker:
    def test_exec_success(self, mock_docker_client, mock_container):
        mock_docker_client.containers.get.return_value = mock_container
        mock_container.exec_run.return_value = (0, b"hello world")
        result = exec_in_worker(mock_docker_client, "dvd-worker-test", "echo hello world")
        assert result == "hello world"

    def test_raises_when_container_not_running(self, mock_docker_client, mock_stopped_container):
        mock_docker_client.containers.get.return_value = mock_stopped_container
        with pytest.raises(RuntimeError, match="not running"):
            exec_in_worker(mock_docker_client, "dvd-worker-test", "echo hi")

    def test_raises_on_nonzero_exit(self, mock_docker_client, mock_container):
        mock_docker_client.containers.get.return_value = mock_container
        mock_container.exec_run.return_value = (1, b"error output")
        with pytest.raises(RuntimeError, match="Command exited with code 1"):
            exec_in_worker(mock_docker_client, "dvd-worker-test", "false")


# ─── build_image ─────────────────────────────────────────────────────────────

class TestBuildImage:
    def test_build_success(self, mock_docker_client):
        with tempfile.TemporaryDirectory() as tmpdir:
            (Path(tmpdir) / "Dockerfile").write_text("FROM scratch\n")
            mock_image = MagicMock()
            mock_docker_client.images.build.return_value = (mock_image, iter([]))
            build_image(mock_docker_client, context_path=tmpdir)
            mock_docker_client.images.build.assert_called_once()

    def test_raises_when_no_dockerfile(self, mock_docker_client):
        with tempfile.TemporaryDirectory() as tmpdir:
            with pytest.raises(FileNotFoundError, match="No Dockerfile"):
                build_image(mock_docker_client, context_path=tmpdir)

    def test_raises_on_build_error(self, mock_docker_client):
        with tempfile.TemporaryDirectory() as tmpdir:
            (Path(tmpdir) / "Dockerfile").write_text("FROM invalid\n")
            mock_docker_client.images.build.side_effect = docker.errors.BuildError(
                "build failed", build_log=iter([])
            )
            with pytest.raises(RuntimeError, match="Image build failed"):
                build_image(mock_docker_client, context_path=tmpdir)


# ─── wait_for_vpn ────────────────────────────────────────────────────────────

class TestWaitForVpn:
    def _running_container(self, ip_json: bytes):
        """Return a mock container that is 'running' and returns ip_json from exec_run."""
        c = MagicMock()
        c.name = "dvd-worker-test"
        c.short_id = "abc"
        c.status = "running"
        c.labels = {
            "dvd.worker": "true",
            "dvd.rpc_token": "tok",
            "dvd.rpc_port": "16800",
            "dvd.vpn_config": "vpn.conf",
        }
        c.exec_run.return_value = (0, ip_json)
        return c

    def test_returns_ip_info_when_vpn_is_up(self, mock_docker_client):
        ip_payload = b'{"ip":"1.2.3.4","country":"NZ","city":"Auckland"}'
        container = self._running_container(ip_payload)
        mock_docker_client.containers.get.return_value = container
        result = wait_for_vpn(mock_docker_client, "dvd-worker-test", timeout=10)
        assert result["ip"] == "1.2.3.4"
        assert result["country"] == "NZ"

    def test_raises_when_container_exits_before_vpn(self, mock_docker_client):
        c = MagicMock()
        c.name = "dvd-worker-test"
        c.short_id = "abc"
        c.status = "exited"
        c.labels = {"dvd.worker": "true", "dvd.rpc_token": "", "dvd.rpc_port": "0", "dvd.vpn_config": ""}
        c.logs.return_value = b"wg-quick: failed"
        mock_docker_client.containers.get.return_value = c
        with pytest.raises(RuntimeError, match="exited before VPN"):
            wait_for_vpn(mock_docker_client, "dvd-worker-test", timeout=5)

    def test_retries_until_exec_succeeds(self, mock_docker_client):
        ip_payload = b'{"ip":"5.6.7.8","country":"DE","city":"Berlin"}'
        container = self._running_container(ip_payload)
        # First two exec_run calls fail, third succeeds
        container.exec_run.side_effect = [
            (1, b""),
            (1, b""),
            (0, ip_payload),
        ]
        mock_docker_client.containers.get.return_value = container
        with patch("cli.docker_client.time.sleep"):
            result = wait_for_vpn(mock_docker_client, "dvd-worker-test", timeout=30)
        assert result["ip"] == "5.6.7.8"

    def test_raises_on_timeout(self, mock_docker_client):
        container = self._running_container(b"")
        container.exec_run.return_value = (1, b"")
        mock_docker_client.containers.get.return_value = container
        with patch("cli.docker_client.time.sleep"):
            with pytest.raises(RuntimeError, match="timed out"):
                wait_for_vpn(mock_docker_client, "dvd-worker-test", timeout=1, poll_interval=0)


# ─── get_container_logs ──────────────────────────────────────────────────────

class TestGetContainerLogs:
    def test_returns_decoded_logs(self, mock_docker_client, mock_container):
        mock_docker_client.containers.get.return_value = mock_container
        mock_container.logs.return_value = b"line1\nline2\n"
        result = get_container_logs(mock_docker_client, "dvd-worker-test", tail=10)
        assert result == "line1\nline2\n"
        mock_container.logs.assert_called_once_with(tail=10)
