"""Lightweight aria2 JSON-RPC client."""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

import requests


class Aria2Error(Exception):
    """Raised when aria2 returns an error response."""


class Aria2Client:
    """Thin wrapper around aria2's JSON-RPC 2.0 interface."""

    def __init__(self, host: str, port: int, token: str, timeout: int = 10) -> None:
        self.url = f"http://{host}:{port}/jsonrpc"
        self._token = token
        self._timeout = timeout

    # ─── Transport ──────────────────────────────────────────────────────────

    def _call(self, method: str, params: list[Any] | None = None) -> Any:
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
            raise Aria2Error(f"Cannot reach aria2 at {self.url}: {exc}") from exc
        except requests.exceptions.Timeout:
            raise Aria2Error(f"Timeout calling aria2 at {self.url}")
        except requests.exceptions.RequestException as exc:
            raise Aria2Error(f"HTTP error: {exc}") from exc

        data = resp.json()
        if "error" in data:
            raise Aria2Error(f"aria2 error {data['error']['code']}: {data['error']['message']}")
        return data["result"]

    # ─── Torrent operations ──────────────────────────────────────────────────

    def add_magnet(self, magnet_uri: str) -> str:
        """Add a magnet link; returns the GID (download ID)."""
        return self._call("aria2.addUri", [[magnet_uri]])

    def add_torrent_file(self, torrent_path: str | Path) -> str:
        """Add a .torrent file; returns the GID."""
        data = Path(torrent_path).read_bytes()
        encoded = base64.b64encode(data).decode()
        return self._call("aria2.addTorrent", [encoded])

    def remove(self, gid: str) -> str:
        """Forcefully remove a download (active or waiting)."""
        return self._call("aria2.forceRemove", [gid])

    def pause(self, gid: str) -> str:
        return self._call("aria2.pause", [gid])

    def resume(self, gid: str) -> str:
        return self._call("aria2.unpause", [gid])

    # ─── Status queries ──────────────────────────────────────────────────────

    def tell_status(self, gid: str) -> dict[str, Any]:
        return self._call("aria2.tellStatus", [gid])

    def tell_active(self) -> list[dict[str, Any]]:
        return self._call("aria2.tellActive")

    def tell_waiting(self, offset: int = 0, num: int = 1000) -> list[dict[str, Any]]:
        return self._call("aria2.tellWaiting", [offset, num])

    def tell_stopped(self, offset: int = 0, num: int = 1000) -> list[dict[str, Any]]:
        return self._call("aria2.tellStopped", [offset, num])

    def get_global_stat(self) -> dict[str, Any]:
        return self._call("aria2.getGlobalStat")

    def get_version(self) -> dict[str, Any]:
        return self._call("aria2.getVersion")

    def is_alive(self) -> bool:
        """Return True if aria2 responds to a version ping."""
        try:
            self.get_version()
            return True
        except Aria2Error:
            return False
