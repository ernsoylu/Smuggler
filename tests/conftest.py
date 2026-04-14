"""Shared pytest fixtures."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def mock_docker_client():
    """A mock docker.DockerClient with containers and images attributes."""
    client = MagicMock()
    client.ping.return_value = True
    return client


@pytest.fixture
def mock_container():
    """A mock docker container representing a running dvd worker."""
    c = MagicMock()
    c.name = "dvd-worker-test"
    c.short_id = "abc123"
    c.status = "running"
    c.labels = {
        "dvd.worker": "true",
        "dvd.rpc_token": "test-token-xyz",
        "dvd.rpc_port": "16800",
        "dvd.vpn_config": "vpn.conf",
    }
    return c


@pytest.fixture
def mock_stopped_container(mock_container):
    mock_container.status = "exited"
    return mock_container
