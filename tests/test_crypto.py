"""Unit tests for api/crypto and encryption-at-rest of OpenVPN passwords."""

from __future__ import annotations

import sqlite3
from unittest.mock import patch

import pytest

import api.crypto as crypto
import api.database as db

KEY = "test-secret-passphrase"


@pytest.fixture
def with_key(monkeypatch):
    monkeypatch.setenv("SMG_SECRET_KEY", KEY)
    return KEY


@pytest.fixture
def without_key(monkeypatch):
    monkeypatch.delenv("SMG_SECRET_KEY", raising=False)


# ─── round-trip ─────────────────────────────────────────────────────────────

class TestRoundTrip:
    def test_encrypt_then_decrypt_recovers_plaintext(self, with_key):
        token = crypto.encrypt("hunter2")
        assert crypto.decrypt(token) == "hunter2"

    def test_ciphertext_is_not_plaintext(self, with_key):
        token = crypto.encrypt("hunter2")
        assert token != "hunter2"
        assert "hunter2" not in token

    def test_ciphertext_has_scheme_prefix(self, with_key):
        assert crypto.encrypt("secret").startswith("fernet:")

    def test_is_encrypted_detects_tokens(self, with_key):
        assert crypto.is_encrypted(crypto.encrypt("secret"))
        assert not crypto.is_encrypted("plain")
        assert not crypto.is_encrypted(None)

    def test_encryption_is_non_deterministic(self, with_key):
        # Fernet embeds a random IV, so two encryptions differ but both decrypt.
        a = crypto.encrypt("same")
        b = crypto.encrypt("same")
        assert a != b
        assert crypto.decrypt(a) == crypto.decrypt(b) == "same"


# ─── empty / None passthrough ───────────────────────────────────────────────

class TestEmptyValues:
    @pytest.mark.parametrize("value", [None, ""])
    def test_encrypt_passthrough(self, with_key, value):
        assert crypto.encrypt(value) == value

    @pytest.mark.parametrize("value", [None, ""])
    def test_decrypt_passthrough(self, with_key, value):
        assert crypto.decrypt(value) == value


# ─── idempotency ────────────────────────────────────────────────────────────

class TestIdempotency:
    def test_encrypt_does_not_double_wrap(self, with_key):
        once = crypto.encrypt("secret")
        twice = crypto.encrypt(once)
        assert once == twice
        assert crypto.decrypt(twice) == "secret"


# ─── no key configured ──────────────────────────────────────────────────────

class TestNoKey:
    def test_encryption_disabled(self, without_key):
        assert crypto.encryption_enabled() is False

    def test_encrypt_returns_plaintext(self, without_key):
        assert crypto.encrypt("secret") == "secret"

    def test_decrypt_plaintext_passthrough(self, without_key):
        assert crypto.decrypt("secret") == "secret"

    def test_decrypt_encrypted_without_key_returns_none(self, with_key, monkeypatch):
        token = crypto.encrypt("secret")
        monkeypatch.delenv("SMG_SECRET_KEY", raising=False)
        assert crypto.decrypt(token) is None


# ─── legacy plaintext rows ──────────────────────────────────────────────────

class TestLegacyPlaintext:
    def test_decrypt_returns_legacy_plaintext_unchanged(self, with_key):
        # A value written before encryption existed has no fernet: prefix.
        assert crypto.decrypt("legacy-plaintext-pw") == "legacy-plaintext-pw"


# ─── wrong key ──────────────────────────────────────────────────────────────

class TestWrongKey:
    def test_wrong_key_fails_closed_to_none(self, monkeypatch):
        monkeypatch.setenv("SMG_SECRET_KEY", "right-key")
        token = crypto.encrypt("secret")
        monkeypatch.setenv("SMG_SECRET_KEY", "wrong-key")
        assert crypto.decrypt(token) is None


# ─── database integration: encryption at rest ───────────────────────────────

@pytest.fixture
def temp_db(tmp_path):
    db_file = tmp_path / "test_smuggler.db"
    with patch.object(db, "DB_PATH", db_file):
        db.init_db()
        yield db_file


def _raw_password(db_file, config_id: int) -> str | None:
    conn = sqlite3.connect(str(db_file))
    row = conn.execute(
        "SELECT ovpn_password FROM vpn_configs WHERE id = ?", (config_id,)
    ).fetchone()
    conn.close()
    return row[0] if row else None


class TestEncryptionAtRest:
    def test_password_stored_encrypted_but_read_plaintext(self, with_key, temp_db):
        config_id = db.add_vpn_config(
            "ovpn", "v.ovpn", b"client\n", "openvpn", True, "user", "s3cr3t"
        )
        # On disk the password is ciphertext...
        raw = _raw_password(temp_db, config_id)
        assert raw is not None and raw.startswith("fernet:")
        assert "s3cr3t" not in raw
        # ...but callers transparently get plaintext back.
        assert db.get_vpn_config(config_id)["ovpn_password"] == "s3cr3t"

    def test_password_stored_plaintext_without_key(self, without_key, temp_db):
        config_id = db.add_vpn_config(
            "ovpn", "v.ovpn", b"client\n", "openvpn", True, "user", "s3cr3t"
        )
        assert _raw_password(temp_db, config_id) == "s3cr3t"
        assert db.get_vpn_config(config_id)["ovpn_password"] == "s3cr3t"


class TestLegacyMigration:
    def test_init_db_encrypts_existing_plaintext_rows(self, with_key, tmp_path):
        db_file = tmp_path / "legacy.db"
        with patch.object(db, "DB_PATH", db_file):
            db.init_db()
            # Seed a plaintext row as if written before encryption existed.
            conn = sqlite3.connect(str(db_file))
            conn.execute(
                "INSERT INTO vpn_configs "
                "(name, filename, content, vpn_type, requires_auth, ovpn_username, ovpn_password) "
                "VALUES ('l', 'l.ovpn', ?, 'openvpn', 1, 'u', 'legacy-pw')",
                (b"client\n",),
            )
            conn.commit()
            conn.close()

            # Re-running init_db (with a key) migrates it in place.
            db.init_db()
            raw = _raw_password(db_file, 1)
            assert raw.startswith("fernet:")
            assert db.get_vpn_config(1)["ovpn_password"] == "legacy-pw"
