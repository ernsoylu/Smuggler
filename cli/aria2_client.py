"""Lightweight aria2 JSON-RPC client."""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

import requests

from cli.log import get_logger, log_safe

log = get_logger(__name__)


class Aria2Error(Exception):
    """Raised when aria2 returns an error response."""


class Aria2Client:
    """Thin wrapper around aria2's JSON-RPC 2.0 interface."""

    def __init__(self, host: str, port: int, token: str, timeout: int = 10) -> None:
        self.url = f"http://{host}:{port}/jsonrpc"
        self._token = token
        self._timeout = timeout
        log.debug("Aria2Client: url=%s", self.url)

    # ─── Transport ──────────────────────────────────────────────────────────

    def _call(self, method: str, params: list[Any] | None = None) -> Any:
        log.debug("aria2 RPC call: method=%s url=%s", method, self.url)
        payload = {
            "jsonrpc": "2.0",
            "id": "dvd",
            "method": method,
            "params": [f"token:{self._token}"] + (params or []),
        }
        try:
            resp = requests.post(self.url, json=payload, timeout=self._timeout)
            resp.raise_for_status()
        except requests.exceptions.ConnectionError as exc:
            log.error("aria2 RPC: connection refused url=%s — %s", self.url, exc)
            raise Aria2Error(f"Cannot reach aria2 at {self.url}: {exc}") from exc
        except requests.exceptions.Timeout:
            log.error("aria2 RPC: timeout url=%s method=%s", self.url, method)
            raise Aria2Error(f"Timeout calling aria2 at {self.url}")
        except requests.exceptions.RequestException as exc:
            log.error("aria2 RPC: HTTP error url=%s method=%s — %s", self.url, method, exc)
            raise Aria2Error(f"HTTP error: {exc}") from exc

        data = resp.json()
        if "error" in data:
            err = data["error"]
            log.error(
                "aria2 RPC: error response method=%s code=%s msg=%s",
                method, err.get("code"), err.get("message"),
            )
            raise Aria2Error(f"aria2 error {err['code']}: {err['message']}")

        log.debug("aria2 RPC: success method=%s", method)
        return data["result"]

    # ─── Torrent operations ──────────────────────────────────────────────

    def add_magnet(self, magnet_uri: str, options: dict | None = None) -> str:
        """Add a magnet link; returns the GID (download ID)."""
        log.info("add_magnet: uri=%s options=%s", magnet_uri[:80], options)
        params: list[Any] = [[magnet_uri]]
        if options:
            params.append(options)
        gid = self._call("aria2.addUri", params)
        log.info("add_magnet: gid=%s", gid)
        return gid

    def add_torrent_file(self, torrent_path: str | Path, options: dict | None = None) -> str:
        """Add a .torrent file; returns the GID."""
        torrent_path = Path(torrent_path)
        log.info("add_torrent_file: path=%s size=%d bytes options=%s", log_safe(torrent_path), torrent_path.stat().st_size, options)
        data = torrent_path.read_bytes()
        encoded = base64.b64encode(data).decode()
        params: list[Any] = [encoded]
        if options:
            # aria2.addTorrent params: [torrent_data, uris[], options{}]
            params.append([])  # empty uris array
            params.append(options)
        gid = self._call("aria2.addTorrent", params)
        log.info("add_torrent_file: gid=%s", gid)
        return gid

    def remove(self, gid: str) -> str:
        """Forcefully remove a download (active or waiting)."""
        safe_gid = log_safe(gid)
        log.info("remove: gid=%s", safe_gid)
        result = self._call("aria2.forceRemove", [gid])
        log.info("remove: done gid=%s", safe_gid)
        return result

    def pause(self, gid: str) -> str:
        safe_gid = log_safe(gid)
        log.info("pause: gid=%s", safe_gid)
        result = self._call("aria2.pause", [gid])
        log.info("pause: done gid=%s", safe_gid)
        return result

    def resume(self, gid: str) -> str:
        safe_gid = log_safe(gid)
        log.info("resume: gid=%s", safe_gid)
        result = self._call("aria2.unpause", [gid])
        log.info("resume: done gid=%s", safe_gid)
        return result

    # ─── Status queries ──────────────────────────────────────────────────

    def tell_status(self, gid: str) -> dict[str, Any]:
        log.debug("tell_status: gid=%s", gid)
        return self._call("aria2.tellStatus", [gid])

    def tell_active(self) -> list[dict[str, Any]]:
        log.debug("tell_active: url=%s", self.url)
        result = self._call("aria2.tellActive")
        log.debug("tell_active: %d items", len(result))
        return result

    def tell_waiting(self, offset: int = 0, num: int = 1000) -> list[dict[str, Any]]:
        log.debug("tell_waiting: url=%s", self.url)
        result = self._call("aria2.tellWaiting", [offset, num])
        log.debug("tell_waiting: %d items", len(result))
        return result

    def tell_stopped(self, offset: int = 0, num: int = 1000) -> list[dict[str, Any]]:
        log.debug("tell_stopped: url=%s", self.url)
        result = self._call("aria2.tellStopped", [offset, num])
        log.debug("tell_stopped: %d items", len(result))
        return result

    def get_global_stat(self) -> dict[str, Any]:
        log.debug("get_global_stat: url=%s", self.url)
        return self._call("aria2.getGlobalStat")

    def get_version(self) -> dict[str, Any]:
        log.debug("get_version: url=%s", self.url)
        return self._call("aria2.getVersion")

    def get_peers(self, gid: str) -> list[dict[str, Any]]:
        """Return active peers for a BitTorrent download."""
        log.debug("get_peers: gid=%s", gid)
        return self._call("aria2.getPeers", [gid])

    def get_option(self, gid: str) -> dict[str, str]:
        """Return per-download options."""
        log.debug("get_option: gid=%s", gid)
        return self._call("aria2.getOption", [gid])

    def change_option(self, gid: str, options: dict[str, str]) -> str:
        """Change per-download options. Returns 'OK'."""
        log.info("change_option: gid=%s options=%s", log_safe(gid), options)
        return self._call("aria2.changeOption", [gid, options])

    def change_global_option(self, options: dict[str, str]) -> str:
        """Change global options (e.g. speed limits). Returns 'OK'."""
        log.info("change_global_option: options=%s", options)
        return self._call("aria2.changeGlobalOption", [options])

    def get_global_option(self) -> dict[str, str]:
        """Fetch current global options."""
        log.debug("get_global_option: url=%s", self.url)
        return self._call("aria2.getGlobalOption")

    def is_alive(self) -> bool:
        """Return True if aria2 responds to a version ping."""
        try:
            self.get_version()
            log.debug("is_alive: True url=%s", self.url)
            return True
        except Aria2Error:
            log.debug("is_alive: False url=%s", self.url)
            return False
