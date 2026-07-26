"""Tests for the secret-redaction layer in cli.log."""

from __future__ import annotations

import logging

import cli.log as smglog
from cli.log import RedactionFilter, redact, scan_secrets


BTIH = "a" * 40


# ─── redact() patterns ───────────────────────────────────────────────────────

class TestRedactPatterns:
    def test_wireguard_private_key_masked(self):
        out = redact("PrivateKey = 2AbC/def+GHI0jklMNOpqrSTUvwxYZ1234567890ab=")
        assert "PrivateKey = [REDACTED]" == out

    def test_aria2_rpc_token_masked(self):
        assert redact("params token:s3cret-value gid=1") == "params token:[REDACTED] gid=1"

    def test_env_style_secret_masked(self):
        assert redact("SMG_SECRET_KEY=hunter2!") == "SMG_SECRET_KEY=[REDACTED]"

    def test_password_masked(self):
        assert redact("ovpn_password: hunter2") == "ovpn_password: [REDACTED]"

    def test_bearer_token_masked(self):
        out = redact("Authorization: Bearer eyJhbGciOi.payload.sig")
        assert "eyJhbGciOi" not in out
        assert "Bearer [REDACTED]" in out

    def test_basic_auth_masked(self):
        out = redact("Authorization: Basic dXNlcjpwYXNz")
        assert "dXNlcjpwYXNz" not in out

    def test_pem_private_key_block_masked(self):
        block = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----"
        out = redact(f"config body: {block}")
        assert "MIIEvQIBADANBg" not in out
        assert "[REDACTED PRIVATE KEY]" in out

    def test_magnet_uri_keeps_info_hash_drops_params(self):
        magnet = f"magnet:?xt=urn:btih:{BTIH}&dn=Secret.Name&tr=http://tracker/announce?passkey=abc"
        out = redact(f"add_torrent: magnet={magnet}")
        assert BTIH in out
        assert "Secret.Name" not in out
        assert "passkey" not in out

    def test_magnet_uri_without_btih_fully_masked(self):
        out = redact("magnet:?tr=http://tracker/announce")
        assert out == "magnet:?[REDACTED]"

    def test_benign_lines_untouched(self):
        for line in (
            "watchdog: mule=smuggler-mule-1 UNHEALTHY (failures=1/3 kind=probe_failed) reason=VPN down",
            "GET /api/mules/: returning 3 mules",
            "add_vpn_config: id=2 name=proton filename=vpn.conf vpn_type=wireguard",
            "aria2 call: method=aria2.tellActive",
        ):
            assert redact(line) == line

    def test_redact_is_idempotent(self):
        once = redact("token:abc PrivateKey = xyz=")
        assert redact(once) == once


# ─── scan_secrets() ──────────────────────────────────────────────────────────

class TestScanSecrets:
    def test_reports_pattern_names(self):
        hits = scan_secrets("PrivateKey = abc= and token:xyz")
        assert hits == ["secret_kv"]

    def test_multiple_patterns(self):
        hits = scan_secrets(f"token:x magnet:?xt=urn:btih:{BTIH}&dn=y")
        assert set(hits) == {"secret_kv", "magnet_uri"}

    def test_clean_text_reports_nothing(self):
        assert scan_secrets("mule deployed, ip=203.0.113.9 country=NL") == []


# ─── RedactionFilter on a live handler ───────────────────────────────────────

class _Capture(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


def _make_logger(name: str) -> tuple[logging.Logger, _Capture]:
    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)
    logger.propagate = False
    handler = _Capture()
    handler.addFilter(RedactionFilter())
    logger.handlers = [handler]
    return logger, handler


class TestRedactionFilter:
    def test_scrubs_formatted_message(self):
        logger, handler = _make_logger("dvd.test.filter1")
        logger.info("starting mule rpc_token=%s port=%d", "sekrit", 6800)
        assert len(handler.records) == 1
        message = handler.records[0].getMessage()
        assert "sekrit" not in message
        assert "rpc_token=[REDACTED] port=6800" in message

    def test_clean_records_pass_untouched_with_lazy_args(self):
        logger, handler = _make_logger("dvd.test.filter2")
        logger.info("sweep complete mules=%d", 4)
        assert handler.records[0].getMessage() == "sweep complete mules=4"

    def test_callback_notified_and_count_increments(self, monkeypatch):
        monkeypatch.setattr(smglog, "_redaction_callbacks", [])
        seen: list[dict] = []
        smglog.on_redaction(seen.append)
        before = smglog.redaction_count()

        logger, _ = _make_logger("dvd.test.filter3")
        logger.warning("leaked password=oops")

        assert smglog.redaction_count() == before + 1
        assert seen and seen[0]["patterns"] == ["secret_kv"]
        assert seen[0]["logger"] == "dvd.test.filter3"

    def test_logging_callback_does_not_recurse(self, monkeypatch):
        monkeypatch.setattr(smglog, "_redaction_callbacks", [])
        logger, handler = _make_logger("dvd.test.filter4")

        def evil_callback(_info: dict) -> None:
            # A callback that logs a secret would re-enter the filter; the
            # thread-local guard must break the cycle instead of recursing.
            logger.error("callback lo password=again")

        smglog.on_redaction(evil_callback)
        logger.warning("first password=oops")
        assert len(handler.records) == 2  # original + one callback record, no loop

    def test_on_redaction_is_idempotent(self, monkeypatch):
        monkeypatch.setattr(smglog, "_redaction_callbacks", [])
        cb = lambda info: None  # noqa: E731
        smglog.on_redaction(cb)
        smglog.on_redaction(cb)
        assert smglog._redaction_callbacks.count(cb) == 1


# ─── retention pruning ───────────────────────────────────────────────────────

class TestPruneOldLogs:
    def test_removes_only_stale_files(self, tmp_path, monkeypatch):
        monkeypatch.setattr(smglog, "_LOGS_DIR", tmp_path)
        monkeypatch.setattr(smglog, "_RETENTION_DAYS", 14)
        now = 1_700_000_000.0
        old = tmp_path / "smuggler_old.log"
        fresh = tmp_path / "smuggler_fresh.log"
        other = tmp_path / "unrelated.txt"
        for f in (old, fresh, other):
            f.write_text("x")
        stale_ts = now - 20 * 86400
        import os
        os.utime(old, (stale_ts, stale_ts))
        os.utime(other, (stale_ts, stale_ts))

        removed = smglog._prune_old_logs(now=now)

        assert removed == 1
        assert not old.exists()
        assert fresh.exists()
        assert other.exists()  # only log-file patterns are touched

    def test_disabled_when_retention_zero(self, tmp_path, monkeypatch):
        monkeypatch.setattr(smglog, "_LOGS_DIR", tmp_path)
        monkeypatch.setattr(smglog, "_RETENTION_DAYS", 0)
        assert smglog._prune_old_logs(now=1_700_000_000.0) == 0
