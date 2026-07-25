"""Tests for the API access-control guard (opt-in token auth + CSRF origin check)."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from api.app import create_app


def _client(monkeypatch, token=None):
    if token is None:
        monkeypatch.delenv("SMG_API_TOKEN", raising=False)
    else:
        monkeypatch.setenv("SMG_API_TOKEN", token)
    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()


class TestTokenAuth:
    def test_health_is_open_even_with_token(self, monkeypatch):
        c = _client(monkeypatch, token="sekret")
        assert c.get("/api/health/").status_code == 200

    def test_protected_endpoint_rejected_without_token(self, monkeypatch):
        c = _client(monkeypatch, token="sekret")
        assert c.get("/api/mules/").status_code == 401

    def test_wrong_token_rejected(self, monkeypatch):
        c = _client(monkeypatch, token="sekret")
        r = c.get("/api/mules/", headers={"X-Smuggler-Token": "nope"})
        assert r.status_code == 401

    def test_protected_endpoint_allowed_with_token(self, monkeypatch):
        c = _client(monkeypatch, token="sekret")
        with patch("api.mules.get_docker_client"), \
             patch("api.mules.list_mules", return_value=[]):
            r = c.get("/api/mules/", headers={"X-Smuggler-Token": "sekret"})
        assert r.status_code == 200

    def test_no_token_configured_allows_requests(self, monkeypatch):
        c = _client(monkeypatch, token=None)
        with patch("api.mules.get_docker_client"), \
             patch("api.mules.list_mules", return_value=[]):
            assert c.get("/api/mules/").status_code == 200

    def test_health_exemption_is_not_a_prefix_match(self, monkeypatch):
        # The exemption must cover /api/health exactly, not everything that
        # merely starts with it — otherwise a future /api/health-something route
        # would be silently unauthenticated. 401 (guard ran) not 404 (routed).
        c = _client(monkeypatch, token="sekret")
        assert c.get("/api/healthz").status_code == 401
        assert c.get("/api/health/secrets").status_code == 401

    def test_health_still_exempt_with_and_without_trailing_slash(self, monkeypatch):
        c = _client(monkeypatch, token="sekret")
        assert c.get("/api/health/").status_code == 200
        # Flask redirects the slashless form rather than 401-ing it.
        assert c.get("/api/health").status_code in (200, 308)


class TestCsrfOriginGuard:
    def test_cross_origin_mutation_refused(self, monkeypatch):
        c = _client(monkeypatch, token=None)
        r = c.post(
            "/api/settings/",
            json={"max_download_speed": "0"},
            headers={"Origin": "http://evil.example"},
        )
        assert r.status_code == 403

    def test_same_origin_mutation_allowed(self, monkeypatch):
        c = _client(monkeypatch, token=None)
        with patch("api.settings.update_settings", return_value={}), \
             patch("api.settings.sync_all_mules"):
            r = c.post(
                "/api/settings/",
                json={"max_download_speed": "0"},
                headers={"Origin": "http://localhost:8887"},
            )
        assert r.status_code != 403

    def test_no_origin_mutation_allowed(self, monkeypatch):
        c = _client(monkeypatch, token=None)
        with patch("api.settings.update_settings", return_value={}), \
             patch("api.settings.sync_all_mules"):
            r = c.post("/api/settings/", json={"max_download_speed": "0"})
        assert r.status_code != 403


class TestContainerTopologyRequiresToken:
    """Mules share the internal RPC network with the API, so they can open
    connections to it. Host networking used to make that impossible."""

    def test_refuses_to_start_without_token_when_mules_share_the_network(self, monkeypatch):
        monkeypatch.delenv("SMG_API_TOKEN", raising=False)
        monkeypatch.setenv("SMG_MULE_RPC_HOST", "container")
        with pytest.raises(RuntimeError, match="SMG_API_TOKEN must be set"):
            create_app()

    def test_starts_with_token_in_container_topology(self, monkeypatch):
        monkeypatch.setenv("SMG_API_TOKEN", "sekret")
        monkeypatch.setenv("SMG_MULE_RPC_HOST", "container")
        assert create_app() is not None

    def test_tokenless_still_allowed_on_the_host(self, monkeypatch):
        # ./start.sh debug and bare `smg` runs address mules over loopback and
        # are not reachable by them, so the token stays optional there.
        monkeypatch.delenv("SMG_API_TOKEN", raising=False)
        monkeypatch.delenv("SMG_MULE_RPC_HOST", raising=False)
        assert create_app() is not None
