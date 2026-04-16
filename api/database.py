"""SQLite database layer for Smuggler settings and VPN configurations."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any

from cli.log import get_logger, log_safe

log = get_logger(__name__)

DB_PATH = Path(os.getenv("SMG_DB_PATH", str(Path(os.getcwd()) / "smuggler.db")))

_SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vpn_configs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    filename       TEXT    NOT NULL,
    content        BLOB    NOT NULL,
    vpn_type       TEXT    NOT NULL DEFAULT 'wireguard',
    requires_auth  INTEGER NOT NULL DEFAULT 0,
    ovpn_username  TEXT,
    ovpn_password  TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
"""

# Migrations for existing databases that pre-date new columns
_MIGRATIONS = [
    "ALTER TABLE vpn_configs ADD COLUMN vpn_type TEXT NOT NULL DEFAULT 'wireguard'",
    "ALTER TABLE vpn_configs ADD COLUMN requires_auth INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE vpn_configs ADD COLUMN ovpn_username TEXT",
    "ALTER TABLE vpn_configs ADD COLUMN ovpn_password TEXT",
]

# Default settings
_DEFAULTS: dict[str, str] = {
    "download_dir": str(Path(os.environ.get("SMG_HOST_ROOT", os.getcwd())) / "downloads"),
    "max_concurrent_downloads": "5",
    "max_download_speed": "0",
    "max_upload_speed": "0",
}


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    """Create tables if they don't exist, run migrations, and seed defaults."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    log.info("init_db: initialising database at %s", DB_PATH)
    conn = _get_conn()
    conn.executescript(_SCHEMA)
    # Run migrations — silently skip if column already exists
    for stmt in _MIGRATIONS:
        try:
            conn.execute(stmt)
        except sqlite3.OperationalError:
            pass
    # Seed defaults
    for key, value in _DEFAULTS.items():
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )
    conn.commit()
    conn.close()
    log.info("init_db: done")


# ── Settings ──────────────────────────────────────────────────────────────────

def get_all_settings() -> dict[str, str]:
    conn = _get_conn()
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    conn.close()
    result = {r["key"]: r["value"] for r in rows}
    # Fill in any missing defaults
    for key, default in _DEFAULTS.items():
        if key not in result:
            result[key] = default
    return result


def get_setting(key: str) -> str:
    conn = _get_conn()
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    conn.close()
    if row:
        return row["value"]
    return _DEFAULTS.get(key, "")


def set_setting(key: str, value: str) -> None:
    conn = _get_conn()
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    conn.commit()
    conn.close()


def update_settings(data: dict[str, Any]) -> dict[str, str]:
    conn = _get_conn()
    for key, value in data.items():
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, str(value)),
        )
    conn.commit()
    conn.close()
    return get_all_settings()


# ── VPN Configs ───────────────────────────────────────────────────────────────

def list_vpn_configs() -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT id, name, filename, vpn_type, requires_auth, created_at "
        "FROM vpn_configs ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        d["vpn_type"] = d.get("vpn_type") or "wireguard"
        d["requires_auth"] = bool(d.get("requires_auth", 0))
        result.append(d)
    return result


def get_vpn_config(config_id: int) -> dict | None:
    conn = _get_conn()
    row = conn.execute(
        "SELECT id, name, filename, content, vpn_type, requires_auth, "
        "ovpn_username, ovpn_password, created_at "
        "FROM vpn_configs WHERE id = ?",
        (config_id,),
    ).fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    d["vpn_type"] = d.get("vpn_type") or "wireguard"
    d["requires_auth"] = bool(d.get("requires_auth", 0))
    return d


def add_vpn_config(
    name: str,
    filename: str,
    content: bytes,
    vpn_type: str = "wireguard",
    requires_auth: bool = False,
    ovpn_username: str | None = None,
    ovpn_password: str | None = None,
) -> int:
    conn = _get_conn()
    cur = conn.execute(
        "INSERT INTO vpn_configs "
        "(name, filename, content, vpn_type, requires_auth, ovpn_username, ovpn_password) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (name, filename, content, vpn_type, int(requires_auth), ovpn_username, ovpn_password),
    )
    conn.commit()
    config_id = cur.lastrowid
    conn.close()
    log.info("add_vpn_config: id=%d name=%s filename=%s vpn_type=%s", config_id, log_safe(name), log_safe(filename), vpn_type)
    return config_id


def delete_vpn_config(config_id: int) -> bool:
    conn = _get_conn()
    cur = conn.execute("DELETE FROM vpn_configs WHERE id = ?", (config_id,))
    conn.commit()
    deleted = cur.rowcount > 0
    conn.close()
    log.info("delete_vpn_config: id=%d deleted=%s", config_id, deleted)
    return deleted
