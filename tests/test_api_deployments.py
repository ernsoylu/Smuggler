"""Tests for /api/deployments — asynchronous deploy with real phase reporting."""

from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

import pytest

import api.deployments as dep
from api.app import create_app
from api.configs import DeployError


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("SMG_API_TOKEN", raising=False)
    monkeypatch.delenv("SMG_MULE_RPC_HOST", raising=False)
    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()


@pytest.fixture(autouse=True)
def clean_jobs():
    with dep._lock:
        dep._jobs.clear()
    yield
    with dep._lock:
        dep._jobs.clear()


def _await_state(job_id: str, state: str, timeout: float = 5.0) -> dict:
    """Wait for a background job to reach *state*."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        with dep._lock:
            job = dep._jobs.get(job_id)
            if job and job["state"] == state:
                return dict(job)
        time.sleep(0.02)
    with dep._lock:
        raise AssertionError(f"job never reached {state}: {dep._jobs.get(job_id)}")


RESULT = {
    "name": "smuggler-mule-abc", "id": "abc", "status": "running",
    "rpc_port": 6800, "vpn_config": "v.conf", "vpn_type": "wireguard",
    "ip_info": {"ip": "1.2.3.4"},
}


class TestStartDeployment:
    def test_rejects_unsafe_mule_name_override(self, client):
        r = client.post("/api/deployments/",
                        json={"config_id": 1, "name": "evil.example.com"})
        assert r.status_code == 400
        assert "mule name" in r.get_json()["error"]

    def test_returns_202_immediately_with_a_pollable_job(self, client):
        with patch("api.deployments.check_deployable", return_value={"vpn_type": "wireguard"}), \
             patch("api.deployments.perform_deploy", return_value=RESULT):
            r = client.post("/api/deployments/", json={"config_id": 1})
        assert r.status_code == 202
        body = r.get_json()
        assert body["state"] == "running"
        assert body["phase"] == "starting"
        assert body["phase_count"] == 4
        assert body["id"]

    def test_requires_an_integer_config_id(self, client):
        assert client.post("/api/deployments/", json={}).status_code == 400
        assert client.post("/api/deployments/", json={"config_id": "x"}).status_code == 400

    def test_propagates_validation_status_before_starting_work(self, client):
        # A config already in use must still 409 rather than 202-then-fail.
        with patch("api.deployments.check_deployable",
                   side_effect=DeployError("in use", 409, in_use_by_mule="m1")), \
             patch("api.deployments.perform_deploy") as deploy:
            r = client.post("/api/deployments/", json={"config_id": 1})
        assert r.status_code == 409
        assert r.get_json()["in_use_by_mule"] == "m1"
        deploy.assert_not_called()

    def test_missing_config_returns_404(self, client):
        with patch("api.deployments.check_deployable",
                   side_effect=DeployError("Config not found", 404)):
            r = client.post("/api/deployments/", json={"config_id": 99})
        assert r.status_code == 404


class TestJobLifecycle:
    def test_successful_deploy_reaches_deployed(self, client):
        with patch("api.deployments.check_deployable", return_value={"vpn_type": "wireguard"}), \
             patch("api.deployments.perform_deploy", return_value=RESULT):
            job_id = client.post("/api/deployments/", json={"config_id": 1}).get_json()["id"]
            job = _await_state(job_id, "succeeded")
        assert job["phase"] == "deployed"
        assert job["result"]["name"] == "smuggler-mule-abc"
        assert job["error"] is None

    def test_failed_deploy_records_the_error(self, client):
        with patch("api.deployments.check_deployable", return_value={"vpn_type": "wireguard"}), \
             patch("api.deployments.perform_deploy",
                   side_effect=DeployError("VPN confirmation timed out", 502)):
            job_id = client.post("/api/deployments/", json={"config_id": 1}).get_json()["id"]
            job = _await_state(job_id, "failed")
        assert "timed out" in job["error"]
        assert job["result"] is None

    def test_unexpected_exception_does_not_wedge_the_job(self, client):
        # A job thread that dies silently would leave the UI spinning forever.
        with patch("api.deployments.check_deployable", return_value={"vpn_type": "wireguard"}), \
             patch("api.deployments.perform_deploy", side_effect=ValueError("boom")):
            job_id = client.post("/api/deployments/", json={"config_id": 1}).get_json()["id"]
            job = _await_state(job_id, "failed")
        assert "Unexpected error" in job["error"]

    def test_get_returns_the_job(self, client):
        with patch("api.deployments.check_deployable", return_value={"vpn_type": "wireguard"}), \
             patch("api.deployments.perform_deploy", return_value=RESULT):
            job_id = client.post("/api/deployments/", json={"config_id": 1}).get_json()["id"]
            _await_state(job_id, "succeeded")
        r = client.get(f"/api/deployments/{job_id}")
        assert r.status_code == 200
        assert r.get_json()["state"] == "succeeded"

    def test_unknown_job_is_404(self, client):
        assert client.get("/api/deployments/nope").status_code == 404

    def test_list_returns_jobs_newest_first(self, client):
        with patch("api.deployments.check_deployable", return_value={"vpn_type": "wireguard"}), \
             patch("api.deployments.perform_deploy", return_value=RESULT):
            first = client.post("/api/deployments/", json={"config_id": 1}).get_json()["id"]
            _await_state(first, "succeeded")
            second = client.post("/api/deployments/", json={"config_id": 2}).get_json()["id"]
            _await_state(second, "succeeded")
        ids = [j["id"] for j in client.get("/api/deployments/").get_json()]
        assert ids[0] == second


class TestPhaseReporting:
    def test_phase_mirrors_what_the_mule_reports(self, client):
        """The job must follow the mule's own phase, not a timer."""
        seen = {}

        def _deploy(config_id, config, name, on_started=None):
            on_started("smuggler-mule-abc")
            # Let the phase poller observe the mocked "connecting" report.
            deadline = time.time() + 3
            while time.time() < deadline:
                with dep._lock:
                    job = next(iter(dep._jobs.values()))
                    if job["phase"] == "connecting":
                        seen["phase"] = "connecting"
                        break
                time.sleep(0.05)
            return RESULT

        with patch("api.deployments.check_deployable", return_value={"vpn_type": "wireguard"}), \
             patch("api.deployments.get_docker_client", return_value=MagicMock()), \
             patch("api.deployments.get_mule_phase",
                   return_value={"phase": "connecting", "status": "starting",
                                 "ip": None, "reason": "waiting for the tunnel"}), \
             patch("api.deployments.perform_deploy", side_effect=_deploy):
            job_id = client.post("/api/deployments/", json={"config_id": 1}).get_json()["id"]
            _await_state(job_id, "succeeded")

        assert seen.get("phase") == "connecting", "job never picked up the mule's phase"

    def test_phase_never_moves_backwards(self, client):
        """A transient read failure reports 'starting'; that must not rewind."""
        with dep._lock:
            dep._jobs["j1"] = {
                "id": "j1", "config_id": 1, "state": "running", "phase": "connecting",
                "detail": "", "mule": "m", "result": None, "error": None, "status": None,
                "started_at": time.time(), "finished_at": None,
            }
        stop = __import__("threading").Event()
        with patch("api.deployments.get_docker_client", return_value=MagicMock()), \
             patch("api.deployments.get_mule_phase",
                   return_value={"phase": "starting", "status": "starting",
                                 "ip": None, "reason": "not readable yet"}):
            t = __import__("threading").Thread(
                target=dep._poll_phase, args=("j1", "m", stop), daemon=True)
            t.start()
            time.sleep(2.0)
            stop.set()
            t.join(timeout=2)
        with dep._lock:
            assert dep._jobs["j1"]["phase"] == "connecting"
