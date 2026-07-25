"""Shared pytest fixtures."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from api import database


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    """Give every test its own throwaway SQLite file.

    ``database.DB_PATH`` is resolved at import time, so setting ``SMG_DB_PATH``
    alone would not redirect it — the module attribute has to be patched too.
    Without this the suite writes to the developer's real smuggler.db and leaks
    state between tests.
    """
    db_file = tmp_path / "smuggler-test.db"
    monkeypatch.setenv("SMG_DB_PATH", str(db_file))
    monkeypatch.setattr(database, "DB_PATH", db_file)
    # Create the schema up front, as create_app() does at startup — otherwise
    # tests that touch settings without building an app hit "no such table".
    database.init_db()
    return db_file


@pytest.fixture
def mock_docker_client():
    """A mock docker.DockerClient with containers and images attributes."""
    client = MagicMock()
    client.ping.return_value = True
    return client


@pytest.fixture
def mock_container():
    """A mock docker container representing a running smoker-mule."""
    c = MagicMock()
    c.name = "smuggler-mule-test"
    c.short_id = "abc123"
    c.status = "running"
    c.labels = {
        "smuggler.mule": "true",
        "smuggler.rpc_token": "test-token-xyz",
        "smuggler.rpc_port": "16800",
        "smuggler.vpn_config": "vpn.conf",
    }
    return c


@pytest.fixture
def mock_stopped_container(mock_container):
    mock_container.status = "exited"
    return mock_container
