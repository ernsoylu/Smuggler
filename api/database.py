"""SQLite database layer for Smuggler settings and VPN configurations."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any

from api.crypto import (
    decrypt,
    decrypt_bytes,
    encrypt,
    encrypt_bytes,
    encryption_enabled,
    is_encrypted,
    is_encrypted_bytes,
    needs_rekey,
    rekey,
    rekey_bytes,
)
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

-- User-assigned category per torrent.
--
-- Keyed by info_hash, not gid: a gid is assigned by one mule's aria2 instance
-- and changes when the watchdog evacuates a torrent to a different mule, which
-- would silently orphan the label. info_hash follows the torrent.
CREATE TABLE IF NOT EXISTS torrent_categories (
    info_hash  TEXT PRIMARY KEY,
    category   TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    conn = sqlite3.connect(str(DB_PATH), timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    # WAL lets readers run during a write, but concurrent *writers* still get an
    # immediate SQLITE_BUSY without this. Gunicorn runs 8 threads alongside the
    # watchdog, so writes to settings/state genuinely overlap.
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _bump_state_version(conn: sqlite3.Connection) -> None:
    """Monotonic counter the desktop client polls to detect external changes.

    Must run inside the caller's transaction so readers never see a mutation
    without the matching version bump.
    """
    row = conn.execute(
        "SELECT value FROM settings WHERE key = 'state_version'"
    ).fetchone()
    try:
        current = int(row["value"]) if row else 0
    except (TypeError, ValueError):
        current = 0
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('state_version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (str(current + 1),),
    )


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
    # Encrypt any legacy plaintext OpenVPN passwords now that a key is available.
    _encrypt_legacy_passwords(conn)
    # Encrypt any legacy plaintext VPN config bodies (WireGuard private keys,
    # inline OpenVPN keys/certs) the same way.
    _encrypt_legacy_content(conn)
    # Move any rows still under the old unsalted SHA-256 key onto scrypt.
    _rekey_legacy_secrets(conn)
    conn.commit()
    conn.close()
    log.info("init_db: done")


def _encrypt_legacy_passwords(conn: sqlite3.Connection) -> None:
    """Upgrade pre-encryption plaintext ``ovpn_password`` rows in place.

    No-op when encryption is disabled (no ``SMG_SECRET_KEY``) or all rows are
    already encrypted. Runs inside ``init_db``'s transaction.
    """
    if not encryption_enabled():
        return
    rows = conn.execute(
        "SELECT id, ovpn_password FROM vpn_configs "
        "WHERE ovpn_password IS NOT NULL AND ovpn_password != ''"
    ).fetchall()
    migrated = 0
    for r in rows:
        if not is_encrypted(r["ovpn_password"]):
            conn.execute(
                "UPDATE vpn_configs SET ovpn_password = ? WHERE id = ?",
                (encrypt(r["ovpn_password"]), r["id"]),
            )
            migrated += 1
    if migrated:
        log.info("init_db: encrypted %d legacy plaintext OpenVPN password(s)", migrated)


def _encrypt_legacy_content(conn: sqlite3.Connection) -> None:
    """Upgrade pre-encryption plaintext ``content`` BLOBs in place.

    No-op when encryption is disabled or all rows are already encrypted. Runs
    inside ``init_db``'s transaction.
    """
    if not encryption_enabled():
        return
    rows = conn.execute(
        "SELECT id, content FROM vpn_configs WHERE content IS NOT NULL"
    ).fetchall()
    migrated = 0
    for r in rows:
        body = r["content"]
        if body and not is_encrypted_bytes(body):
            conn.execute(
                "UPDATE vpn_configs SET content = ? WHERE id = ?",
                (encrypt_bytes(body), r["id"]),
            )
            migrated += 1
    if migrated:
        log.info("init_db: encrypted %d legacy plaintext VPN config body/ies", migrated)


def _rekey_legacy_secrets(conn: sqlite3.Connection) -> None:
    """Rotate v1 (unsalted SHA-256) ciphertext onto the current scrypt key.

    Rows already under the current key are left alone, so this is a no-op after
    the first run. Runs inside ``init_db``'s transaction.
    """
    if not encryption_enabled():
        return
    rows = conn.execute(
        "SELECT id, content, ovpn_password FROM vpn_configs"
    ).fetchall()
    rotated = 0
    for r in rows:
        updates: dict[str, Any] = {}
        if needs_rekey(r["content"]):
            updates["content"] = rekey_bytes(r["content"])
        if needs_rekey(r["ovpn_password"]):
            updates["ovpn_password"] = rekey(r["ovpn_password"])
        if not updates:
            continue
        assignments = ", ".join(f"{col} = ?" for col in updates)
        conn.execute(
            f"UPDATE vpn_configs SET {assignments} WHERE id = ?",  # noqa: S608 - column names are literals above
            (*updates.values(), r["id"]),
        )
        rotated += 1
    if rotated:
        log.info("init_db: re-keyed %d config(s) from SHA-256 onto scrypt", rotated)


# ── Torrent categories ────────────────────────────────────────────────────────

def get_torrent_categories() -> dict[str, str]:
    """All ``info_hash -> category`` assignments.

    Returned whole rather than per-torrent: the list endpoint fans out over
    every mule concurrently, and one query beats N lookups inside that fan-out.
    """
    conn = _get_conn()
    rows = conn.execute("SELECT info_hash, category FROM torrent_categories").fetchall()
    conn.close()
    return {r["info_hash"]: r["category"] for r in rows}


def set_torrent_category(info_hash: str, category: str) -> None:
    """Assign a category, or clear it when *category* is empty."""
    conn = _get_conn()
    cleaned = category.strip()
    if cleaned:
        conn.execute(
            "INSERT INTO torrent_categories (info_hash, category, updated_at) "
            "VALUES (?, ?, datetime('now')) "
            "ON CONFLICT(info_hash) DO UPDATE SET category=excluded.category, "
            "updated_at=excluded.updated_at",
            (info_hash, cleaned),
        )
    else:
        conn.execute("DELETE FROM torrent_categories WHERE info_hash = ?", (info_hash,))
    _bump_state_version(conn)
    conn.commit()
    conn.close()
    log.info("set_torrent_category: hash=%s category=%s", log_safe(info_hash), log_safe(cleaned) or "(cleared)")


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
    if key != "state_version":
        _bump_state_version(conn)
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
    _bump_state_version(conn)
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
    # Transparently decrypt the stored secrets back to plaintext for callers.
    d["ovpn_password"] = decrypt(d.get("ovpn_password"))
    d["content"] = decrypt_bytes(d.get("content"))
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
        (name, filename, encrypt_bytes(content), vpn_type, int(requires_auth),
         ovpn_username, encrypt(ovpn_password)),
    )
    _bump_state_version(conn)
    conn.commit()
    config_id = cur.lastrowid
    conn.close()
    log.info("add_vpn_config: id=%d name=%s filename=%s vpn_type=%s", config_id, log_safe(name), log_safe(filename), vpn_type)
    return config_id


def delete_vpn_config(config_id: int) -> bool:
    conn = _get_conn()
    cur = conn.execute("DELETE FROM vpn_configs WHERE id = ?", (config_id,))
    if cur.rowcount > 0:
        _bump_state_version(conn)
    conn.commit()
    deleted = cur.rowcount > 0
    conn.close()
    log.info("delete_vpn_config: id=%d deleted=%s", config_id, deleted)
    return deleted
