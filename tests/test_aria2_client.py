"""Unit tests for cli.aria2_client."""

from __future__ import annotations

import base64
import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import requests.exceptions
import responses as resp_lib

from cli.aria2_client import Aria2Client, Aria2Error

BASE_URL = "http://localhost:16800/jsonrpc"


def make_client() -> Aria2Client:
    return Aria2Client(host="localhost", port=16800, token="test-token")


def rpc_success(result) -> dict:
    return {"jsonrpc": "2.0", "id": "dvd", "result": result}


def rpc_error(code: int, msg: str) -> dict:
    return {"jsonrpc": "2.0", "id": "dvd", "error": {"code": code, "message": msg}}


# ─── _call / transport ───────────────────────────────────────────────────────

class TestTransport:
    @resp_lib.activate
    def test_adds_token_to_params(self):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_success("1234"))
        client = make_client()
        client.add_magnet("magnet:?xt=urn:test")
        body = json.loads(resp_lib.calls[0].request.body)
        assert body["params"][0] == "token:test-token"

    @resp_lib.activate
    def test_raises_aria2_error_on_rpc_error(self):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_error(-32600, "Bad request"))
        client = make_client()
        with pytest.raises(Aria2Error, match="Bad request"):
            client.get_version()

    @resp_lib.activate
    def test_raises_aria2_error_on_connection_refused(self):
        resp_lib.add(
            resp_lib.POST,
            BASE_URL,
            body=requests.exceptions.ConnectionError("Connection refused"),
        )
        client = make_client()
        with pytest.raises(Aria2Error, match="Cannot reach aria2"):
            client.get_version()

    @resp_lib.activate
    def test_raises_aria2_error_on_http_error(self):
        resp_lib.add(resp_lib.POST, BASE_URL, status=500)
        client = make_client()
        with pytest.raises(Aria2Error):
            client.get_version()


# ─── add_magnet ──────────────────────────────────────────────────────────────

class TestAddMagnet:
    @resp_lib.activate
    def test_returns_gid(self):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_success("abc123gid"))
        client = make_client()
        gid = client.add_magnet("magnet:?xt=urn:btih:abc")
        assert gid == "abc123gid"

    @resp_lib.activate
    def test_sends_correct_method(self):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_success("x"))
        client = make_client()
        client.add_magnet("magnet:?xt=urn:btih:abc")
        body = json.loads(resp_lib.calls[0].request.body)
        assert body["method"] == "aria2.addUri"
        assert "magnet:?xt=urn:btih:abc" in body["params"][1]


# ─── add_torrent_file ────────────────────────────────────────────────────────

class TestAddTorrentFile:
    @resp_lib.activate
    def test_encodes_file_as_base64(self):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_success("torrentgid"))
        client = make_client()

        with tempfile.NamedTemporaryFile(suffix=".torrent", delete=False) as f:
            f.write(b"d8:announce...")
            path = f.name

        try:
            gid = client.add_torrent_file(path)
            assert gid == "torrentgid"
            body = json.loads(resp_lib.calls[0].request.body)
            assert body["method"] == "aria2.addTorrent"
            expected_b64 = base64.b64encode(b"d8:announce...").decode()
            assert body["params"][1] == expected_b64
        finally:
            Path(path).unlink()


# ─── tell_active / tell_waiting / tell_stopped ───────────────────────────────

class TestTellMethods:
    @resp_lib.activate
    def test_tell_active_returns_list(self):
        downloads = [{"gid": "aaa", "status": "active"}]
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_success(downloads))
        client = make_client()
        result = client.tell_active()
        assert result == downloads

    @resp_lib.activate
    def test_tell_waiting_sends_offset_and_num(self):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_success([]))
        client = make_client()
        client.tell_waiting(offset=5, num=50)
        body = json.loads(resp_lib.calls[0].request.body)
        assert body["method"] == "aria2.tellWaiting"
        assert body["params"][1] == 5
        assert body["params"][2] == 50

    @resp_lib.activate
    def test_tell_stopped_method_name(self):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_success([]))
        client = make_client()
        client.tell_stopped()
        body = json.loads(resp_lib.calls[0].request.body)
        assert body["method"] == "aria2.tellStopped"


# ─── remove / pause / resume ────────────────────────────────────────────────

class TestMutationMethods:
    @resp_lib.activate
    def test_remove_calls_force_remove(self):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_success("aaa"))
        client = make_client()
        result = client.remove("aaa")
        assert result == "aaa"
        body = json.loads(resp_lib.calls[0].request.body)
        assert body["method"] == "aria2.forceRemove"

    @resp_lib.activate
    def test_pause_method(self):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_success("aaa"))
        client = make_client()
        client.pause("aaa")
        body = json.loads(resp_lib.calls[0].request.body)
        assert body["method"] == "aria2.pause"

    @resp_lib.activate
    def test_resume_method(self):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_success("aaa"))
        client = make_client()
        client.resume("aaa")
        body = json.loads(resp_lib.calls[0].request.body)
        assert body["method"] == "aria2.unpause"


# ─── is_alive ────────────────────────────────────────────────────────────────

class TestIsAlive:
    @resp_lib.activate
    def test_true_when_aria2_responds(self):
        resp_lib.add(resp_lib.POST, BASE_URL, json=rpc_success({"version": "1.36.0"}))
        assert make_client().is_alive() is True

    @resp_lib.activate
    def test_false_when_aria2_unreachable(self):
        resp_lib.add(resp_lib.POST, BASE_URL, body=requests.exceptions.ConnectionError("down"))
        assert make_client().is_alive() is False
