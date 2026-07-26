"""Tests for the systemwide observer engine and its endpoints."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from api.app import create_app
from api.database import list_events
from cli.aria2_client import Aria2Error
import api.observer as obs


@pytest.fixture(autouse=True)
def reset_observer_state():
    """Clear shared observer state between tests."""
    with obs._lock:
        obs._observed.clear()
        obs._log_cursor.clear()
        obs._observer_stats.update({
            "started_at": None,
            "last_sweep_at": None,
            "total_sweeps": 0,
            "events_recorded": 0,
        })
    yield


@pytest.fixture
def app():
    a = create_app()
    a.config["TESTING"] = True
    return a


@pytest.fixture
def client(app):
    return app.test_client()


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


PHASE_DEPLOYED = {"phase": "deployed", "status": "healthy", "ip": "203.0.113.9", "reason": ""}
GLOBAL_STAT = {"downloadSpeed": "1024", "uploadSpeed": "256",
               "numActive": "2", "numWaiting": "1", "numStopped": "0"}


def _patch_probes(phase=PHASE_DEPLOYED, health="healthy", stat=GLOBAL_STAT):
    """Patch the three per-mule probes _observe_mule fans out to."""
    aria2 = MagicMock()
    if isinstance(stat, Exception):
        aria2.get_global_stat.side_effect = stat
    else:
        aria2.get_global_stat.return_value = stat
    return (
        patch("api.observer.get_docker_health", return_value=health),
        patch("api.observer.get_mule_phase", return_value=phase),
        patch("api.observer.aria2_for", return_value=aria2),
    )


# ─── observer_enabled ────────────────────────────────────────────────────────

class TestObserverEnabled:
    def test_default_enabled(self, monkeypatch):
        monkeypatch.delenv("SMG_OBSERVER_ENABLED", raising=False)
        assert obs.observer_enabled() is True

    @pytest.mark.parametrize("value", ["false", "0", "no", "off", "FALSE"])
    def test_disabled_values(self, monkeypatch, value):
        monkeypatch.setenv("SMG_OBSERVER_ENABLED", value)
        assert obs.observer_enabled() is False

    def test_start_observer_respects_disable(self, monkeypatch):
        monkeypatch.setenv("SMG_OBSERVER_ENABLED", "false")
        obs.start_observer()
        assert obs._observer_thread is None


# ─── _observe_mule ───────────────────────────────────────────────────────────

class TestObserveMule:
    def test_non_running_mule_skips_probes(self):
        mule = make_mule_info(status="exited")
        result = obs._observe_mule(MagicMock(), mule)
        assert result["status"] == "exited"
        assert result["docker_health"] is None
        assert result["vpn_status"] is None
        assert result["aria2_alive"] is None

    def test_running_mule_collects_all_surfaces(self):
        mule = make_mule_info()
        p1, p2, p3 = _patch_probes()
        with p1, p2, p3:
            result = obs._observe_mule(MagicMock(), mule)
        assert result["docker_health"] == "healthy"
        assert result["vpn_status"] == "healthy"
        assert result["vpn_phase"] == "deployed"
        assert result["vpn_ip"] == "203.0.113.9"
        assert result["aria2_alive"] is True
        assert result["aria2"] == {"download_speed": 1024, "upload_speed": 256,
                                   "num_active": 2, "num_waiting": 1, "num_stopped": 0}

    def test_aria2_error_marks_not_alive(self):
        mule = make_mule_info()
        p1, p2, p3 = _patch_probes(stat=Aria2Error("connection refused"))
        with p1, p2, p3:
            result = obs._observe_mule(MagicMock(), mule)
        assert result["aria2_alive"] is False
        assert result["aria2"] is None


# ─── _severity_for / _diff_and_emit ──────────────────────────────────────────

class TestDiffAndEmit:
    def test_first_observation_emits_mule_observed(self):
        result = {"name": "m1", "status": "running", "docker_health": "healthy",
                  "vpn_status": "healthy", "vpn_phase": "deployed",
                  "vpn_ip": "203.0.113.9", "vpn_reason": "", "aria2_alive": True}
        obs._diff_and_emit(None, result)
        events = list_events(kind="mule_observed")
        assert len(events) == 1
        assert events[0]["mule"] == "m1"
        assert events[0]["payload"]["status"] == "running"

    def test_no_change_emits_nothing(self):
        state = {"name": "m1", "status": "running", "docker_health": "healthy",
                 "vpn_status": "healthy", "vpn_phase": "deployed",
                 "vpn_reason": "", "aria2_alive": True}
        obs._diff_and_emit(dict(state), dict(state))
        assert list_events(source="observer") == []

    def test_vpn_death_is_critical_with_reason(self):
        prev = {"name": "m1", "status": "running", "docker_health": "healthy",
                "vpn_status": "healthy", "vpn_phase": "deployed",
                "vpn_reason": "", "aria2_alive": True}
        curr = {**prev, "vpn_status": "dead", "vpn_reason": "kill-switch: handshake stale"}
        obs._diff_and_emit(prev, curr)
        events = list_events(kind="vpn_status_change")
        assert len(events) == 1
        assert events[0]["severity"] == "critical"
        assert events[0]["payload"] == {
            "from": "healthy", "to": "dead", "reason": "kill-switch: handshake stale",
        }

    def test_container_exit_is_warning(self):
        prev = {"name": "m1", "status": "running", "docker_health": None,
                "vpn_status": None, "vpn_phase": None, "vpn_reason": "", "aria2_alive": None}
        curr = {**prev, "status": "exited"}
        obs._diff_and_emit(prev, curr)
        events = list_events(kind="mule_status_change")
        assert events[0]["severity"] == "warning"

    def test_severity_grading(self):
        assert obs._severity_for("vpn_status", "dead") == "critical"
        assert obs._severity_for("vpn_status", "healthy") == "info"
        assert obs._severity_for("status", "exited") == "warning"
        assert obs._severity_for("status", "running") == "info"
        assert obs._severity_for("docker_health", "unhealthy") == "warning"
        assert obs._severity_for("aria2_alive", False) == "warning"
        assert obs._severity_for("aria2_alive", True) == "info"


# ─── _harvest_logs ───────────────────────────────────────────────────────────

class TestHarvestLogs:
    def test_secret_in_stdout_recorded_without_the_secret(self):
        mule = make_mule_info()
        mule.container.logs.return_value = b"parsed config\nPrivateKey = leaked-key-material=\n"
        obs._harvest_logs(mule, since_ts=1000)
        events = list_events(kind="mule_log_secret")
        assert len(events) == 1
        assert events[0]["severity"] == "critical"
        assert events[0]["payload"]["patterns"] == ["secret_kv"]
        assert "leaked-key-material" not in str(events[0]["payload"])

    def test_kill_switch_trigger_recorded(self):
        mule = make_mule_info()
        mule.container.logs.return_value = (
            b"[2026-07-26] KILL-SWITCH TRIGGERED: wg handshake stale (200s)\n"
        )
        obs._harvest_logs(mule, since_ts=1000)
        events = list_events(kind="kill_switch_triggered")
        assert len(events) == 1
        assert "handshake stale" in events[0]["payload"]["line"]

    def test_clean_logs_emit_nothing(self):
        mule = make_mule_info()
        mule.container.logs.return_value = b"external IP: 203.0.113.9 country=NL\n"
        obs._harvest_logs(mule, since_ts=1000)
        assert list_events(source="observer") == []

    def test_docker_error_is_swallowed(self):
        import docker.errors
        mule = make_mule_info()
        mule.container.logs.side_effect = docker.errors.APIError("boom")
        obs._harvest_logs(mule, since_ts=1000)  # must not raise
        assert list_events(source="observer") == []


# ─── _run_sweep ──────────────────────────────────────────────────────────────

class TestRunSweep:
    def test_docker_unreachable_returns_empty(self):
        with patch("api.observer.get_docker_client", side_effect=RuntimeError("no docker")):
            assert obs._run_sweep() == []

    def _sweep_with(self, mules):
        client = MagicMock()
        p1, p2, p3 = _patch_probes()
        with patch("api.observer.get_docker_client", return_value=client), \
             patch("api.observer.list_mules", return_value=mules), \
             p1, p2, p3:
            return obs._run_sweep()

    def test_first_sweep_observes_and_sets_cursor_without_harvest(self):
        mule = make_mule_info()
        mule.container.logs.return_value = b"PrivateKey = should-not-be-scanned-yet\n"
        results = self._sweep_with([mule])
        assert len(results) == 1
        assert len(list_events(kind="mule_observed")) == 1
        # First sweep only positions the cursor — no backlog replay.
        mule.container.logs.assert_not_called()
        assert mule.name in obs._log_cursor

    def test_second_sweep_harvests_since_cursor(self):
        mule = make_mule_info()
        mule.container.logs.return_value = b"clean line\n"
        self._sweep_with([mule])
        cursor = obs._log_cursor[mule.name]
        self._sweep_with([mule])
        mule.container.logs.assert_called_once_with(since=cursor)

    def test_transition_between_sweeps_recorded(self):
        mule = make_mule_info()
        mule.container.logs.return_value = b""
        self._sweep_with([mule])

        client = MagicMock()
        p1, p2, p3 = _patch_probes(phase={**PHASE_DEPLOYED, "status": "dead",
                                          "reason": "kill-switch: probes failed"})
        with patch("api.observer.get_docker_client", return_value=client), \
             patch("api.observer.list_mules", return_value=[mule]), \
             p1, p2, p3:
            obs._run_sweep()

        events = list_events(kind="vpn_status_change")
        assert len(events) == 1
        assert events[0]["payload"]["to"] == "dead"

    def test_vanished_mule_emits_removed_and_drops_state(self):
        mule = make_mule_info()
        mule.container.logs.return_value = b""
        self._sweep_with([mule])
        self._sweep_with([])
        events = list_events(kind="mule_removed")
        assert len(events) == 1
        assert events[0]["mule"] == mule.name
        assert obs._observed == {}
        assert obs._log_cursor == {}

    def test_snapshot_cadence(self, monkeypatch):
        monkeypatch.setattr(obs, "SNAPSHOT_EVERY", 2)
        mule = make_mule_info()
        mule.container.logs.return_value = b""
        self._sweep_with([mule])
        assert list_events(kind="snapshot") == []
        self._sweep_with([mule])
        events = list_events(kind="snapshot")
        assert len(events) == 1
        payload = events[0]["payload"]
        assert payload["num_mules"] == 1
        assert payload["by_status"] == {"running": 1}
        assert payload["download_speed"] == 1024

    def test_prune_cadence(self, monkeypatch):
        monkeypatch.setattr(obs, "_PRUNE_EVERY", 1)
        pruner = MagicMock(return_value=0)
        monkeypatch.setattr(obs, "prune_events", pruner)
        self._sweep_with([])
        pruner.assert_called_once_with(obs.EVENTS_RETENTION_DAYS, obs.EVENTS_MAX_ROWS)


# ─── endpoints ───────────────────────────────────────────────────────────────

class TestObserverEndpoints:
    def test_status_reports_config_and_state(self, client):
        resp = client.get("/api/observer/")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["config"]["interval_seconds"] == obs.OBSERVER_INTERVAL
        assert data["config"]["enabled"] is False  # conftest disables the thread
        assert data["stats"]["total_sweeps"] == 0
        assert data["mules"] == []

    def test_manual_run_sweeps_synchronously(self, client):
        mule = make_mule_info()
        mule.container.logs.return_value = b""
        docker_client = MagicMock()
        p1, p2, p3 = _patch_probes()
        with patch("api.observer.get_docker_client", return_value=docker_client), \
             patch("api.observer.list_mules", return_value=[mule]), \
             p1, p2, p3:
            resp = client.post("/api/observer/run")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["observed"] == 1
        assert data["results"][0]["vpn_phase"] == "deployed"
        assert obs._observer_stats["total_sweeps"] == 1
