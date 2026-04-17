"""Integration tests for /api/torrents endpoints."""

from __future__ import annotations

import io
import json
from unittest.mock import MagicMock, patch

import pytest
import responses as resp_lib
import requests

from api.app import create_app
from cli.aria2_client import Aria2Error

ARIA2_URL = "http://localhost:16800/jsonrpc"


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
    c.short_id = "abc"
    c.status = status
    c.labels = {
        "smuggler.mule": "true",
        "smuggler.rpc_token": "tok",
        "smuggler.rpc_port": "16800",
        "smuggler.vpn_config": "vpn.conf",
    }
    return MuleInfo(c)


ACTIVE_DL = {
    "gid": "abc123",
    "status": "active",
    "completedLength": "500000000",
    "totalLength": "1000000000",
    "downloadSpeed": "2097152",
    "uploadSpeed": "524288",
    "numSeeders": "10",
    "connections": "5",
    "bittorrent": {"info": {"name": "MyMovie.mkv"}},
    "files": [],
}


def rpc_ok(result):
    return {"jsonrpc": "2.0", "id": "dvd", "result": result}


# ─── GET /api/torrents/ ──────────────────────────────────────────────────────

class TestListAllTorrents:
    @resp_lib.activate
    def test_aggregates_across_workers(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok([ACTIVE_DL]))  # tellActive
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok([]))           # tellWaiting
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok([]))           # tellStopped

        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.list_mules", return_value=[mule]):
            r = client.get("/api/torrents/")

        assert r.status_code == 200
        data = r.get_json()
        assert len(data) == 1
        assert data[0]["gid"] == "abc123"
        assert data[0]["name"] == "MyMovie.mkv"
        assert abs(data[0]["progress"] - 50.0) < 1e-9

    def test_returns_empty_when_no_workers(self, client):
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.list_mules", return_value=[]):
            r = client.get("/api/torrents/")
        assert r.status_code == 200
        assert r.get_json() == []


# ─── GET /api/torrents/<mule> ──────────────────────────────────────────────────

class TestListWorkerTorrents:
    @resp_lib.activate
    def test_lists_torrents_for_worker(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok([ACTIVE_DL]))
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok([]))
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok([]))

        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.get("/api/torrents/smuggler-mule-test")

        assert r.status_code == 200
        assert len(r.get_json()) == 1

    def test_returns_404_for_unknown_worker(self, client):
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule",
                   side_effect=RuntimeError("Mule not found")):
            r = client.get("/api/torrents/ghost")
        assert r.status_code == 404


# ─── POST /api/torrents/<mule> ─────────────────────────────────────────────

class TestAddTorrent:
    @resp_lib.activate
    def test_add_magnet(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok("newgid123"))

        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.post(
                "/api/torrents/smuggler-mule-test",
                json={"magnet": "magnet:?xt=urn:btih:abc"},
            )

        assert r.status_code == 201
        assert r.get_json()["gid"] == "newgid123"

    @resp_lib.activate
    def test_add_torrent_file(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok("filegid456"))

        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.post(
                "/api/torrents/smuggler-mule-test",
                data={"torrent_file": (io.BytesIO(b"d8:announce...e"), "file.torrent")},
                content_type="multipart/form-data",
            )

        assert r.status_code == 201
        assert r.get_json()["gid"] == "filegid456"

    def test_returns_400_without_payload(self, client):
        mule = make_mule_info()
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.post("/api/torrents/smuggler-mule-test",
                            json={})
        assert r.status_code == 400

    @resp_lib.activate
    def test_returns_502_on_aria2_error(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL,
                     json={"jsonrpc": "2.0", "id": "dvd",
                           "error": {"code": -1, "message": "Invalid URI"}})

        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.post(
                "/api/torrents/smuggler-mule-test",
                json={"magnet": "magnet:?xt=bad"},
            )

        assert r.status_code == 502
        assert "Invalid URI" in r.get_json()["error"]


# ─── DELETE /api/torrents/<mule>/<gid> ─────────────────────────────────────

class TestRemoveTorrent:
    @resp_lib.activate
    def test_removes_torrent(self, client):
        mule = make_mule_info()
        # DELETE first calls tellStatus (dict result), then removes via aria2.
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok(ACTIVE_DL))
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok("abc123"))

        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.delete("/api/torrents/smuggler-mule-test/abc123")

        assert r.status_code == 200
        assert r.get_json()["ok"] is True


# ─── POST /api/torrents/<mule>/<gid>/pause|resume ──────────────────────────

class TestPauseResume:
    @resp_lib.activate
    def test_pause(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok("abc123"))

        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.post("/api/torrents/smuggler-mule-test/abc123/pause")

        assert r.status_code == 200

    @resp_lib.activate
    def test_resume(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok("abc123"))

        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.post("/api/torrents/smuggler-mule-test/abc123/resume")

        assert r.status_code == 200


# ─── Helper unit tests ────────────────────────────────────────────────────────

class TestSerializeFiles:
    def test_serializes_file_with_progress(self):
        from api.torrents import _serialize_files
        dl = {"files": [{"index": "1", "path": "/downloads/movie.mkv",
                          "length": "1000", "completedLength": "500", "selected": "true"}]}
        result = _serialize_files(dl)
        assert len(result) == 1
        assert result[0]["name"] == "movie.mkv"
        assert result[0]["progress"] == 50.0
        assert result[0]["selected"] is True

    def test_zero_total_gives_zero_progress(self):
        from api.torrents import _serialize_files
        dl = {"files": [{"index": "1", "path": "/downloads/f.mkv",
                          "length": "0", "completedLength": "0"}]}
        result = _serialize_files(dl)
        assert result[0]["progress"] == 0.0

    def test_empty_path_gives_dash_name(self):
        from api.torrents import _serialize_files
        dl = {"files": [{"index": "1", "path": "", "length": "0", "completedLength": "0"}]}
        result = _serialize_files(dl)
        assert result[0]["name"] == "—"


class TestExtractTracker:
    def test_empty_announce_list_returns_empty(self):
        from api.torrents import _extract_tracker
        assert _extract_tracker({}) == ""
        assert _extract_tracker({"announceList": []}) == ""
        assert _extract_tracker({"announceList": [[]]}) == ""

    def test_extracts_first_tracker(self):
        from api.torrents import _extract_tracker
        bt = {"announceList": [["udp://tracker.example.com:6969"]]}
        assert _extract_tracker(bt) == "udp://tracker.example.com:6969"

    def test_handles_string_entry(self):
        from api.torrents import _extract_tracker
        bt = {"announceList": ["udp://tracker.example.com:6969"]}
        assert _extract_tracker(bt) == "udp://tracker.example.com:6969"


class TestSerializeDownload:
    def test_calculates_eta(self):
        from api.torrents import _serialize_download
        dl = {
            "gid": "abc", "status": "active",
            "completedLength": "500000000", "totalLength": "1000000000",
            "downloadSpeed": "1000000", "uploadSpeed": "0", "uploadLength": "0",
            "numSeeders": "0", "connections": "0",
            "bittorrent": {"info": {"name": "movie.mkv"}},
            "files": [],
        }
        result = _serialize_download(dl, "mule-a")
        assert result["eta"] == 500  # 500MB / 1MB/s

    def test_eta_is_minus1_when_no_speed(self):
        from api.torrents import _serialize_download
        dl = {
            "gid": "abc", "status": "active",
            "completedLength": "0", "totalLength": "1000", "downloadSpeed": "0",
            "uploadSpeed": "0", "uploadLength": "0",
            "numSeeders": "0", "connections": "0",
            "bittorrent": {}, "files": [],
        }
        result = _serialize_download(dl, "mule-a")
        assert result["eta"] == -1

    def test_filters_completed_metadata(self):
        from api.torrents import _all_downloads
        from unittest.mock import MagicMock
        metadata_dl = {
            "gid": "meta1", "status": "complete",
            "completedLength": "10000", "totalLength": "10000",
            "downloadSpeed": "0", "uploadSpeed": "0", "uploadLength": "0",
            "numSeeders": "0", "connections": "0",
            "bittorrent": {"info": {"name": "[METADATA] SomeTorrent"}},
            "followedBy": ["gid2"],
            "files": [],
        }
        aria2 = MagicMock()
        aria2.tell_active.return_value = [metadata_dl]
        aria2.tell_waiting.return_value = []
        aria2.tell_stopped.return_value = []
        result = _all_downloads(aria2, "mule-a")
        assert result == []


class TestCollectDeletePaths:
    def test_maps_downloads_paths(self, tmp_path):
        from api.torrents import _collect_delete_paths
        status = {"files": [{"path": "/downloads/movie/movie.mkv"}]}
        paths = _collect_delete_paths(status, str(tmp_path))
        assert len(paths) == 1
        assert paths[0] == tmp_path / "movie" / "movie.mkv"

    def test_ignores_non_downloads_paths(self, tmp_path):
        from api.torrents import _collect_delete_paths
        status = {"files": [{"path": "/other/path/file.mkv"}]}
        paths = _collect_delete_paths(status, str(tmp_path))
        assert paths == []

    def test_ignores_empty_path(self, tmp_path):
        from api.torrents import _collect_delete_paths
        status = {"files": [{"path": ""}]}
        paths = _collect_delete_paths(status, str(tmp_path))
        assert paths == []


class TestDropFromAria2:
    def test_removes_active_download(self):
        from api.torrents import _drop_from_aria2
        aria2 = MagicMock()
        _drop_from_aria2(aria2, "gid1", "active")
        aria2.remove.assert_called_once_with("gid1")

    def test_purges_stopped_download(self):
        from api.torrents import _drop_from_aria2
        aria2 = MagicMock()
        _drop_from_aria2(aria2, "gid1", "complete")
        aria2.remove_download_result.assert_called_once_with("gid1")

    def test_handles_aria2_error_gracefully(self):
        from api.torrents import _drop_from_aria2
        aria2 = MagicMock()
        aria2.remove.side_effect = Aria2Error("Not found")
        _drop_from_aria2(aria2, "gid1", "active")  # should not raise


class TestUnlinkAndPrune:
    def test_deletes_files(self, tmp_path):
        from api.torrents import _unlink_and_prune
        f = tmp_path / "sub" / "file.mkv"
        f.parent.mkdir()
        f.write_bytes(b"data")
        _unlink_and_prune([f], str(tmp_path))
        assert not f.exists()

    def test_prunes_empty_parent_dir(self, tmp_path):
        from api.torrents import _unlink_and_prune
        sub = tmp_path / "sub"
        sub.mkdir()
        f = sub / "file.mkv"
        f.write_bytes(b"data")
        _unlink_and_prune([f], str(tmp_path))
        assert not sub.exists()

    def test_does_not_prune_nonempty_dir(self, tmp_path):
        from api.torrents import _unlink_and_prune
        sub = tmp_path / "sub"
        sub.mkdir()
        f1 = sub / "file1.mkv"
        f2 = sub / "file2.mkv"
        f1.write_bytes(b"data")
        f2.write_bytes(b"data")
        _unlink_and_prune([f1], str(tmp_path))
        assert sub.exists()


# ─── Error paths for existing endpoints ─────────────────────────────────────

class TestListForMuleErrors:
    @resp_lib.activate
    def test_returns_502_on_aria2_error(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL,
                     json={"jsonrpc": "2.0", "id": "dvd",
                           "error": {"code": -1, "message": "aria2 down"}})
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.get("/api/torrents/smuggler-mule-test")
        assert r.status_code == 502


class TestAddMagnetWithDn:
    @resp_lib.activate
    def test_sets_dir_from_dn_param(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok("gid123"))
        magnet = "magnet:?xt=urn:btih:abc&dn=My+Movie"
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.post("/api/torrents/smuggler-mule-test", json={"magnet": magnet})
        assert r.status_code == 201

    def test_returns_400_for_missing_magnet_in_json(self, client):
        mule = make_mule_info()
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.post("/api/torrents/smuggler-mule-test",
                            json={"magnet": "  "})
        assert r.status_code == 400


class TestAddTorrentFileErrors:
    @resp_lib.activate
    def test_returns_502_on_aria2_error(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL,
                     json={"jsonrpc": "2.0", "id": "dvd",
                           "error": {"code": -1, "message": "Invalid torrent"}})
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.post(
                "/api/torrents/smuggler-mule-test",
                data={"torrent_file": (io.BytesIO(b"bad data"), "bad.torrent")},
                content_type="multipart/form-data",
            )
        assert r.status_code == 502

    def test_returns_404_when_mule_not_running(self, client):
        stopped = make_mule_info(status="exited")
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=stopped):
            r = client.post(
                "/api/torrents/smuggler-mule-test",
                data={"torrent_file": (io.BytesIO(b"data"), "file.torrent")},
                content_type="multipart/form-data",
            )
        assert r.status_code == 404


class TestDeleteErrors:
    @resp_lib.activate
    def test_returns_502_on_aria2_status_error(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL,
                     json={"jsonrpc": "2.0", "id": "dvd",
                           "error": {"code": -1, "message": "GID not found"}})
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.delete("/api/torrents/smuggler-mule-test/badgid")
        assert r.status_code == 502

    @resp_lib.activate
    def test_delete_with_files_flag(self, client, tmp_path):
        mule = make_mule_info()
        dl_with_files = {**ACTIVE_DL, "files": [{"path": "/downloads/movie.mkv"}]}
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok(dl_with_files))  # tellStatus
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok("abc123"))       # remove
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule), \
             patch("api.settings.read_settings", return_value={"download_dir": str(tmp_path)}):
            r = client.delete("/api/torrents/smuggler-mule-test/abc123?delete_files=true")
        assert r.status_code == 200


class TestPauseResumeErrors:
    def test_pause_returns_404_on_mule_error(self, client):
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", side_effect=RuntimeError("not found")):
            r = client.post("/api/torrents/ghost/abc123/pause")
        assert r.status_code == 404

    @resp_lib.activate
    def test_pause_returns_502_on_aria2_error(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL,
                     json={"jsonrpc": "2.0", "id": "dvd",
                           "error": {"code": -1, "message": "Cannot pause"}})
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.post("/api/torrents/smuggler-mule-test/abc123/pause")
        assert r.status_code == 502

    def test_resume_returns_404_on_mule_error(self, client):
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", side_effect=RuntimeError("not found")):
            r = client.post("/api/torrents/ghost/abc123/resume")
        assert r.status_code == 404

    @resp_lib.activate
    def test_resume_returns_502_on_aria2_error(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL,
                     json={"jsonrpc": "2.0", "id": "dvd",
                           "error": {"code": -1, "message": "Cannot resume"}})
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.post("/api/torrents/smuggler-mule-test/abc123/resume")
        assert r.status_code == 502


class TestGetPeers:
    @resp_lib.activate
    def test_returns_peer_list(self, client):
        mule = make_mule_info()
        peer = {"ip": "5.6.7.8", "port": "51413", "downloadSpeed": "1024",
                "uploadSpeed": "512", "seeder": False, "progress": 5000,
                "amChoking": False, "peerChoking": True}
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok([peer]))
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.get("/api/torrents/smuggler-mule-test/abc123/peers")
        assert r.status_code == 200
        data = r.get_json()
        assert len(data) == 1
        assert data[0]["ip"] == "5.6.7.8"
        assert data[0]["download_speed"] == 1024

    def test_returns_404_on_mule_error(self, client):
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", side_effect=RuntimeError("not found")):
            r = client.get("/api/torrents/ghost/abc123/peers")
        assert r.status_code == 404

    @resp_lib.activate
    def test_returns_empty_on_aria2_error(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL,
                     json={"jsonrpc": "2.0", "id": "dvd",
                           "error": {"code": -1, "message": "Not found"}})
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.get("/api/torrents/smuggler-mule-test/abc123/peers")
        assert r.status_code == 200
        assert r.get_json() == []


class TestGetOptions:
    @resp_lib.activate
    def test_returns_options(self, client):
        mule = make_mule_info()
        opts = {"max-download-limit": "1048576", "max-upload-limit": "524288",
                "max-connection-per-server": "4"}
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok(opts))
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.get("/api/torrents/smuggler-mule-test/abc123/options")
        assert r.status_code == 200
        data = r.get_json()
        assert data["max_download_speed"] == 1048576
        assert data["max_connections"] == 4

    def test_returns_404_on_mule_error(self, client):
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", side_effect=RuntimeError("not found")):
            r = client.get("/api/torrents/ghost/abc123/options")
        assert r.status_code == 404

    @resp_lib.activate
    def test_returns_502_on_aria2_error(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL,
                     json={"jsonrpc": "2.0", "id": "dvd",
                           "error": {"code": -1, "message": "GID error"}})
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.get("/api/torrents/smuggler-mule-test/abc123/options")
        assert r.status_code == 502


class TestSetOptions:
    @resp_lib.activate
    def test_sets_download_speed(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok({}))
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.patch("/api/torrents/smuggler-mule-test/abc123/options",
                             json={"max_download_speed": 2097152})
        assert r.status_code == 200

    def test_returns_400_with_no_valid_options(self, client):
        mule = make_mule_info()
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.patch("/api/torrents/smuggler-mule-test/abc123/options",
                             json={"unknown_key": 123})
        assert r.status_code == 400

    def test_returns_404_on_mule_error(self, client):
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", side_effect=RuntimeError("not found")):
            r = client.patch("/api/torrents/ghost/abc123/options",
                             json={"max_download_speed": 1024})
        assert r.status_code == 404

    @resp_lib.activate
    def test_returns_502_on_aria2_error(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL,
                     json={"jsonrpc": "2.0", "id": "dvd",
                           "error": {"code": -1, "message": "Option error"}})
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.patch("/api/torrents/smuggler-mule-test/abc123/options",
                             json={"max_upload_speed": 512000})
        assert r.status_code == 502


class TestSetFileSelection:
    @resp_lib.activate
    def test_sets_selected_files(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL, json=rpc_ok({}))
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.patch("/api/torrents/smuggler-mule-test/abc123/files",
                             json={"selected_indices": [1, 3]})
        assert r.status_code == 200

    def test_returns_400_for_invalid_type(self, client):
        mule = make_mule_info()
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.patch("/api/torrents/smuggler-mule-test/abc123/files",
                             json={"selected_indices": "not-a-list"})
        assert r.status_code == 400

    def test_returns_404_on_mule_error(self, client):
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", side_effect=RuntimeError("not found")):
            r = client.patch("/api/torrents/ghost/abc123/files",
                             json={"selected_indices": [1]})
        assert r.status_code == 404

    @resp_lib.activate
    def test_returns_502_on_aria2_error(self, client):
        mule = make_mule_info()
        resp_lib.add(resp_lib.POST, ARIA2_URL,
                     json={"jsonrpc": "2.0", "id": "dvd",
                           "error": {"code": -1, "message": "Select error"}})
        with patch("api.torrents.get_docker_client"), \
             patch("api.torrents.get_mule", return_value=mule):
            r = client.patch("/api/torrents/smuggler-mule-test/abc123/files",
                             json={"selected_indices": [2]})
        assert r.status_code == 502
