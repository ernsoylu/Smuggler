"""Tests for /api/watchdog endpoints and internal helpers."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import threading

import pytest

from api.app import create_app
import api.watchdog as wd


@pytest.fixture(autouse=True)
def reset_watchdog_state():
    """Clear shared watchdog state between tests."""
    with wd._lock:
        wd._mule_states.clear()
        wd._expected_stops.clear()
        wd._watchdog_stats.update({
            "started_at": None,
            "last_run_at": None,
            "total_sweeps": 0,
            "total_evacuations": 0,
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


HEALTHY_RESULT = {"name": "smuggler-mule-test", "healthy": True,
                  "ip": "1.2.3.4", "reason": "", "kind": "probe_failed"}
UNHEALTHY_RESULT = {"name": "smuggler-mule-test", "healthy": False,
                    "ip": None, "reason": "VPN down", "kind": "probe_failed"}


# ─── Unit: _threshold_for ────────────────────────────────────────────────────

class TestThresholdFor:
    def test_ip_leak_is_1(self):
        assert wd._threshold_for({"kind": "ip_leak"}) == 1

    def test_not_running_is_8(self):
        assert wd._threshold_for({"kind": "not_running"}) == 8

    def test_unknown_kind_returns_default(self):
        assert wd._threshold_for({"kind": "something_new"}) == wd.FAILURE_THRESHOLD

    def test_missing_kind_returns_default(self):
        assert wd._threshold_for({}) == wd.FAILURE_THRESHOLD


# ─── Unit: _probe_mule ──────────────────────────────────────────────────────

class TestProbeMule:
    def test_running_mule_calls_check_vpn(self):
        mule = make_mule_info(status="running")
        client = MagicMock()
        check_result = {"name": mule.name, "healthy": True, "ip": "1.2.3.4", "reason": ""}
        with patch("api.watchdog.check_mule_vpn", return_value=check_result) as mock_check:
            result = wd._probe_mule(client, mule)
        mock_check.assert_called_once_with(client, mule.name)
        assert result["healthy"] is True

    def test_exited_mule_returns_exited_kind(self):
        mule = make_mule_info(status="exited")
        result = wd._probe_mule(MagicMock(), mule)
        assert result["healthy"] is False
        assert result["kind"] == "exited"

    def test_restarting_mule_returns_restarting_kind(self):
        mule = make_mule_info(status="restarting")
        result = wd._probe_mule(MagicMock(), mule)
        assert result["healthy"] is False
        assert result["kind"] == "restarting"


# ─── Unit: _record_result ───────────────────────────────────────────────────

class TestRecordResult:
    def test_healthy_result_resets_consecutive_failures(self):
        wd._mule_states["mule-a"] = {"consecutive_failures": 5, "evacuated": False}
        consecutive, evacuated = wd._record_result("mule-a", HEALTHY_RESULT, 3)
        assert consecutive == 0
        assert evacuated is False

    def test_unhealthy_result_increments_consecutive_failures(self):
        wd._mule_states["mule-a"] = {"consecutive_failures": 2, "evacuated": False}
        consecutive, _ = wd._record_result("mule-a", UNHEALTHY_RESULT, 3)
        assert consecutive == 3

    def test_new_mule_starts_at_one_on_failure(self):
        consecutive, evacuated = wd._record_result("new-mule", UNHEALTHY_RESULT, 3)
        assert consecutive == 1
        assert evacuated is False

    def test_preserves_evacuated_flag(self):
        wd._mule_states["mule-b"] = {"consecutive_failures": 3, "evacuated": True}
        _, evacuated = wd._record_result("mule-b", UNHEALTHY_RESULT, 3)
        assert evacuated is True


# ─── Unit: _do_evacuation ───────────────────────────────────────────────────

class TestDoEvacuation:
    def test_calls_evacuate_and_marks_evacuated(self):
        wd._mule_states["mule-x"] = {"consecutive_failures": 3, "evacuated": False}
        report = {"migrated": ["gid1"], "skipped": [], "killed": True}
        with patch("api.watchdog.evacuate_mule", return_value=report):
            wd._do_evacuation(MagicMock(), "mule-x", 3)
        assert wd._mule_states["mule-x"]["evacuated"] is True
        assert wd._watchdog_stats["total_evacuations"] == 1

    def test_handles_evacuation_exception(self):
        wd._mule_states["mule-y"] = {"consecutive_failures": 3, "evacuated": False}
        with patch("api.watchdog.evacuate_mule", side_effect=RuntimeError("Docker gone")):
            wd._do_evacuation(MagicMock(), "mule-y", 3)
        assert wd._watchdog_stats["total_evacuations"] == 1


# ─── Unit: _finalise_sweep ──────────────────────────────────────────────────

class TestFinaliseSweep:
    def test_removes_stale_mules(self):
        wd._mule_states["old-mule"] = {"healthy": True}
        wd._mule_states["active-mule"] = {"healthy": True}
        wd._finalise_sweep({"active-mule"}, "2026-01-01T00:00:00+00:00")
        assert "old-mule" not in wd._mule_states
        assert "active-mule" in wd._mule_states

    def test_updates_sweep_stats(self):
        wd._finalise_sweep(set(), "2026-01-01T00:00:00+00:00")
        assert wd._watchdog_stats["total_sweeps"] == 1
        assert wd._watchdog_stats["last_run_at"] == "2026-01-01T00:00:00+00:00"


# ─── Unit: _run_sweep ───────────────────────────────────────────────────────

class TestRunSweep:
    def test_returns_empty_on_docker_error(self):
        with patch("api.watchdog.get_docker_client",
                   side_effect=RuntimeError("Docker unavailable")):
            results = wd._run_sweep()
        assert results == []

    def test_runs_sweep_for_running_mule(self):
        mule = make_mule_info(status="running")
        vpn_result = {**HEALTHY_RESULT, "kind": "probe_failed"}
        with patch("api.watchdog.get_docker_client"), \
             patch("api.watchdog.list_mules", return_value=[mule]), \
             patch("api.watchdog.check_mule_vpn", return_value=vpn_result):
            results = wd._run_sweep()
        assert len(results) == 1
        assert results[0]["healthy"] is True

    def test_triggers_evacuation_on_threshold(self):
        mule = make_mule_info(status="running")
        unhealthy = {**UNHEALTHY_RESULT, "kind": "probe_failed"}
        # Seed state so it's already at threshold
        wd._mule_states[mule.name] = {"consecutive_failures": 2, "evacuated": False}
        with patch("api.watchdog.get_docker_client"), \
             patch("api.watchdog.list_mules", return_value=[mule]), \
             patch("api.watchdog.check_mule_vpn", return_value=unhealthy), \
             patch("api.watchdog.evacuate_mule", return_value={"migrated": [], "skipped": [], "killed": True}):
            wd._run_sweep()
        assert wd._mule_states[mule.name]["evacuated"] is True


# ─── GET /api/watchdog/ ──────────────────────────────────────────────────────

class TestWatchdogStatus:
    def test_returns_config_and_stats(self, client):
        r = client.get("/api/watchdog/")
        assert r.status_code == 200
        body = r.get_json()
        assert "config" in body
        assert "stats" in body
        assert "mules" in body
        assert body["config"]["interval_seconds"] == wd.WATCHDOG_INTERVAL

    def test_includes_mule_states(self, client):
        wd._mule_states["smuggler-mule-test"] = {
            "name": "smuggler-mule-test", "healthy": True, "ip": "1.2.3.4"
        }
        r = client.get("/api/watchdog/")
        body = r.get_json()
        assert len(body["mules"]) == 1
        assert body["mules"][0]["name"] == "smuggler-mule-test"


# ─── GET /api/watchdog/<name> ────────────────────────────────────────────────

class TestWatchdogMule:
    def test_returns_mule_state(self, client):
        wd._mule_states["smuggler-mule-test"] = {
            "name": "smuggler-mule-test", "healthy": True, "ip": "1.2.3.4"
        }
        r = client.get("/api/watchdog/smuggler-mule-test")
        assert r.status_code == 200
        assert r.get_json()["ip"] == "1.2.3.4"

    def test_returns_404_for_unknown_mule(self, client):
        r = client.get("/api/watchdog/ghost-mule")
        assert r.status_code == 404


# ─── POST /api/watchdog/run ──────────────────────────────────────────────────

class TestWatchdogRun:
    def test_returns_sweep_results(self, client):
        mule = make_mule_info(status="running")
        vpn_result = {**HEALTHY_RESULT, "kind": "probe_failed"}
        with patch("api.watchdog.get_docker_client"), \
             patch("api.watchdog.list_mules", return_value=[mule]), \
             patch("api.watchdog.check_mule_vpn", return_value=vpn_result):
            r = client.post("/api/watchdog/run")
        assert r.status_code == 200
        body = r.get_json()
        assert body["swept"] == 1

    def test_returns_zero_swept_on_docker_error(self, client):
        with patch("api.watchdog.get_docker_client",
                   side_effect=RuntimeError("Docker down")):
            r = client.post("/api/watchdog/run")
        assert r.status_code == 200
        assert r.get_json()["swept"] == 0


# ─── POST /api/watchdog/<name>/evacuate ─────────────────────────────────────

class TestWatchdogEvacuate:
    def test_evacuates_mule(self, client):
        report = {"migrated": ["gid1"], "skipped": [], "killed": True}
        with patch("api.watchdog.get_docker_client"), \
             patch("api.watchdog.evacuate_mule", return_value=report):
            r = client.post("/api/watchdog/smuggler-mule-test/evacuate")
        assert r.status_code == 200
        assert r.get_json()["killed"] is True
        assert wd._watchdog_stats["total_evacuations"] == 1

    def test_marks_mule_evacuated_in_state(self, client):
        wd._mule_states["smuggler-mule-test"] = {"healthy": False, "evacuated": False}
        with patch("api.watchdog.get_docker_client"), \
             patch("api.watchdog.evacuate_mule", return_value={"migrated": [], "skipped": [], "killed": True}):
            client.post("/api/watchdog/smuggler-mule-test/evacuate")
        assert wd._mule_states["smuggler-mule-test"]["evacuated"] is True

    def test_returns_500_on_docker_error(self, client):
        with patch("api.watchdog.get_docker_client",
                   side_effect=RuntimeError("Docker unavailable")):
            r = client.post("/api/watchdog/smuggler-mule-test/evacuate")
        assert r.status_code == 500

    def test_returns_500_on_evacuate_error(self, client):
        with patch("api.watchdog.get_docker_client"), \
             patch("api.watchdog.evacuate_mule",
                   side_effect=RuntimeError("Cannot evacuate")):
            r = client.post("/api/watchdog/smuggler-mule-test/evacuate")
        assert r.status_code == 500

    def test_kill_false_param(self, client):
        with patch("api.watchdog.get_docker_client"), \
             patch("api.watchdog.evacuate_mule", return_value={"migrated": [], "skipped": [], "killed": False}) as mock_ev:
            r = client.post("/api/watchdog/smuggler-mule-test/evacuate?kill=false")
        assert r.status_code == 200
        mock_ev.assert_called_once_with(mock_ev.call_args[0][0], "smuggler-mule-test", kill_after=False)


class TestStartWatchdogIdempotence:
    """start_watchdog() promises it will not start a second thread."""

    @pytest.fixture(autouse=True)
    def _inert_thread(self, monkeypatch):
        """Let the thread start, but never let it sweep.

        These are the only tests that want a real thread. They used to get a
        real *sweeping* one: `_reset()` clears the module handle but nothing
        stops the thread, so each run leaked a daemon that kept issuing HTTP
        through `requests` for the rest of the session — polluting
        `responses.calls` in unrelated tests. Swapping the loop for a park
        keeps the idempotence guard under test and the sweep out of it.
        """
        stop = threading.Event()
        monkeypatch.setenv("SMG_WATCHDOG_ENABLED", "true")
        monkeypatch.setattr(wd, "_watchdog_loop", stop.wait)
        wd._watchdog_thread = None
        yield
        # Actually stop it. Parking the thread instead of sweeping removes the
        # HTTP, but a thread left alive is still a leak, and the isolation test
        # below fails on one.
        stop.set()
        thread = wd._watchdog_thread
        if isinstance(thread, threading.Thread):
            thread.join(timeout=2)
        wd._watchdog_thread = None

    def test_second_call_does_not_start_another_thread(self):
        wd.start_watchdog()
        first = wd._watchdog_thread
        wd.start_watchdog()
        assert wd._watchdog_thread is first

    def test_restarts_when_previous_thread_died(self):
        class _Dead:
            ident = 1
            def is_alive(self):
                return False

        wd._watchdog_thread = _Dead()
        wd.start_watchdog()
        assert wd._watchdog_thread is not None
        assert wd._watchdog_thread.is_alive()

    def test_does_not_start_when_disabled(self, monkeypatch):
        monkeypatch.setenv("SMG_WATCHDOG_ENABLED", "false")
        wd.start_watchdog()
        assert wd._watchdog_thread is None


# ─── Evacuation audit events ─────────────────────────────────────────────────

class TestEvacuationEvents:
    def test_auto_evacuation_records_trigger_and_completion(self):
        from api.database import list_events
        report = {"migrated": ["gid1", "gid2"], "skipped": [], "killed": True}
        with patch("api.watchdog.evacuate_mule", return_value=report):
            wd._do_evacuation(MagicMock(), "smuggler-mule-test", consecutive=3)

        triggered = list_events(kind="evacuation_triggered")
        assert len(triggered) == 1
        assert triggered[0]["source"] == "watchdog"
        assert triggered[0]["severity"] == "critical"
        assert triggered[0]["payload"] == {"failures": 3}

        complete = list_events(kind="evacuation_complete")
        assert len(complete) == 1
        assert complete[0]["payload"] == {"migrated": 2, "skipped": 0, "killed": True}

    def test_failed_evacuation_records_error(self):
        from api.database import list_events
        with patch("api.watchdog.evacuate_mule", side_effect=RuntimeError("no healthy mules")):
            wd._do_evacuation(MagicMock(), "smuggler-mule-test", consecutive=3)

        errors = list_events(kind="evacuation_error")
        assert len(errors) == 1
        assert errors[0]["payload"] == {"error": "no healthy mules"}

    def test_manual_evacuation_endpoint_records_event(self, client):
        from api.database import list_events
        report = {"migrated": [], "skipped": ["gid9"], "killed": True}
        with patch("api.watchdog.get_docker_client"), \
             patch("api.watchdog.evacuate_mule", return_value=report):
            resp = client.post("/api/watchdog/smuggler-mule-test/evacuate")
        assert resp.status_code == 200

        manual = list_events(kind="evacuation_manual")
        assert len(manual) == 1
        assert manual[0]["payload"] == {"kill_after": True, "migrated": 0, "skipped": 1}


# ─── Expected stops (user-initiated teardown must not read as unhealthy) ─────

class TestExpectedStop:
    def test_sweep_skips_marked_stopping_mule(self):
        """Regression: a graceful stop racing a sweep raised "VPN compromised"."""
        wd.mark_expected_stop("smuggler-mule-test")
        mule = make_mule_info(status="exited")
        with patch("api.watchdog.get_docker_client"), \
             patch("api.watchdog.list_mules", return_value=[mule]):
            results = wd._run_sweep()
        assert results == []
        with wd._lock:
            assert "smuggler-mule-test" not in wd._mule_states

    def test_sweep_drops_prior_state_for_marked_mule(self):
        with wd._lock:
            wd._mule_states["smuggler-mule-test"] = {"healthy": False, "consecutive_failures": 1}
        wd.mark_expected_stop("smuggler-mule-test")
        mule = make_mule_info(status="exited")
        with patch("api.watchdog.get_docker_client"), \
             patch("api.watchdog.list_mules", return_value=[mule]):
            wd._run_sweep()
        with wd._lock:
            assert "smuggler-mule-test" not in wd._mule_states

    def test_expired_marker_flags_exited_mule_again(self):
        wd.mark_expected_stop("smuggler-mule-test", ttl=-1)
        mule = make_mule_info(status="exited")
        with patch("api.watchdog.get_docker_client"), \
             patch("api.watchdog.list_mules", return_value=[mule]):
            results = wd._run_sweep()
        assert len(results) == 1
        assert results[0]["healthy"] is False
        assert results[0]["kind"] == "exited"

    def test_marker_does_not_mask_a_running_mule(self):
        """The marker only excuses non-running statuses — a live container is
        still probed, so a real VPN failure during the stop window is caught."""
        wd.mark_expected_stop("smuggler-mule-test")
        mule = make_mule_info(status="running")
        with patch("api.watchdog.get_docker_client"), \
             patch("api.watchdog.list_mules", return_value=[mule]), \
             patch("api.watchdog.check_mule_vpn", return_value=dict(UNHEALTHY_RESULT)):
            results = wd._run_sweep()
        assert len(results) == 1
        assert results[0]["healthy"] is False

    def test_marker_purged_once_container_is_gone(self):
        wd.mark_expected_stop("smuggler-mule-test")
        with patch("api.watchdog.get_docker_client"), \
             patch("api.watchdog.list_mules", return_value=[]):
            wd._run_sweep()
        with wd._lock:
            assert "smuggler-mule-test" not in wd._expected_stops

    def test_manual_evacuate_endpoint_marks_expected_stop(self, client):
        report = {"migrated": [], "skipped": [], "killed": True}
        with patch("api.watchdog.get_docker_client"), \
             patch("api.watchdog.evacuate_mule", return_value=report):
            resp = client.post("/api/watchdog/smuggler-mule-test/evacuate")
        assert resp.status_code == 200
        with wd._lock:
            assert "smuggler-mule-test" in wd._expected_stops

    def test_manual_evacuate_keep_does_not_mark(self, client):
        report = {"migrated": [], "skipped": [], "killed": False}
        with patch("api.watchdog.get_docker_client"), \
             patch("api.watchdog.evacuate_mule", return_value=report):
            resp = client.post("/api/watchdog/smuggler-mule-test/evacuate?kill=false")
        assert resp.status_code == 200
        with wd._lock:
            assert "smuggler-mule-test" not in wd._expected_stops


class TestWatchdogThreadIsolation:
    """The sweep thread must not run during the suite.

    A live sweep reaches ``requests`` through the aria2 and Docker clients, and
    ``responses`` patches ``requests`` process-wide — so a sweep landing inside
    a ``@responses.activate`` test appends to ``responses.calls`` and shifts the
    call that test asserts on. That produced a failure that appeared only in
    full runs, roughly one run in three.
    """

    def test_conftest_disables_the_watchdog(self):
        assert wd.watchdog_enabled() is False

    def test_create_app_starts_no_sweep_thread(self):
        wd._watchdog_thread = None
        create_app()
        assert wd._watchdog_thread is None

    def test_no_watchdog_thread_is_alive_anywhere_in_the_session(self):
        # Catches a test that starts a real one and forgets to stop it.
        live = [t for t in threading.enumerate() if t.name == "smuggler-watchdog" and t.is_alive()]
        assert live == [], f"leaked watchdog thread(s): {live}"

    def test_enabled_by_default_outside_the_suite(self, monkeypatch):
        # The guard must not change production behaviour: absent the variable,
        # the watchdog still runs.
        monkeypatch.delenv("SMG_WATCHDOG_ENABLED", raising=False)
        assert wd.watchdog_enabled() is True
