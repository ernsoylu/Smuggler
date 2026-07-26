"""
Shared logging setup for Smuggler (CLI + API).

Reads from environment / .env file:
  SMG_LOGGING             true | false  (default: true)
  SMG_LOG_LEVEL           DEBUG | INFO | WARNING | ERROR  (default: INFO)
  SMG_LOG_RETENTION_DAYS  days to keep old log files, 0 disables  (default: 14)

The pre-rebrand ``DVD_*`` names are still honoured as a fallback so existing
.env files keep working.

A single log file is created per process start:
  logs/smuggler_YYYY-MM-DD_HH-MM-SS.log

Every record passes through a redaction filter that masks secret-shaped values
(private keys, tokens, passwords, magnet URI parameters) before they reach any
handler. A redaction firing means something tried to log a secret — observers
can subscribe via :func:`on_redaction` to turn that into an auditable event.
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import re
import sys
import threading
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

# Load .env once when this module is first imported.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

_SESSION_TS = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
_LOGS_DIR = Path(__file__).resolve().parent.parent / "logs"
_LOG_FILE = _LOGS_DIR / f"smuggler_{_SESSION_TS}.log"


def _env(name: str, default: str) -> str:
    """Read SMG_<name>, falling back to the pre-rebrand DVD_<name>."""
    return os.getenv(f"SMG_{name}") or os.getenv(f"DVD_{name}") or default


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


_ENABLED: bool = _env("LOGGING", "true").strip().lower() not in ("false", "0", "no", "off")
_LEVEL_STR: str = _env("LOG_LEVEL", "INFO").strip().upper()
_LEVEL: int = getattr(logging, _LEVEL_STR, logging.INFO)

# Every pytest invocation is a fresh process; writing a file per run buried
# logs/ under hundreds of test artifacts. Console output and redaction still
# apply under pytest — only the file handler (and retention pruning) are off.
_UNDER_PYTEST: bool = "pytest" in sys.modules
_FILE_ENABLED: bool = _ENABLED and not _UNDER_PYTEST

_RETENTION_DAYS: int = _env_int("LOG_RETENTION_DAYS", 14)
_MAX_BYTES = 10 * 1024 * 1024
_BACKUP_COUNT = 3

_FMT = logging.Formatter(
    fmt="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

# ── Secret redaction ─────────────────────────────────────────────────────────

_MASK = "[REDACTED]"

_BTIH = re.compile(r"xt=urn:btih:([0-9A-Fa-f]{40}|[A-Za-z2-7]{32})")


def _mask_magnet(match: re.Match[str]) -> str:
    """Keep the info-hash (needed to correlate with the torrent list), drop the
    rest — dn/tracker parameters can carry usernames or passkeys."""
    hit = _BTIH.search(match.group(0))
    if hit:
        return f"magnet:?xt=urn:btih:{hit.group(1)}&{_MASK}"
    return f"magnet:?{_MASK}"


# Ordered: the PEM block first, so key material inside it is swallowed whole
# before the key=value pattern can leave fragments behind. The key=value
# pattern deliberately over-matches (any identifier ending in key/token/
# secret/password) — masking too much is safe, missing a secret is not.
_PATTERNS: tuple[tuple[str, re.Pattern[str], Callable[[re.Match[str]], str] | str], ...] = (
    (
        "private_key_block",
        re.compile(r"-----BEGIN[A-Z ]*PRIVATE KEY-----.*?(?:-----END[A-Z ]*PRIVATE KEY-----|\Z)", re.S),
        "[REDACTED PRIVATE KEY]",
    ),
    (
        "secret_kv",
        re.compile(r"(?i)\b([\w.-]*(?:key|token|secret|password|passwd))\b(\s*[=:]\s*)\S+"),
        r"\1\2" + _MASK,
    ),
    ("bearer_token", re.compile(r"(?i)\b(bearer\s+)[A-Za-z0-9\-._~+/]+=*"), r"\1" + _MASK),
    ("basic_auth", re.compile(r"(?i)\b(basic\s+)[A-Za-z0-9+/=]{8,}"), r"\1" + _MASK),
    ("magnet_uri", re.compile(r"magnet:\?\S+"), _mask_magnet),
)


def _redact_with_hits(text: str) -> tuple[str, list[str]]:
    """Return (scrubbed text, names of the patterns that fired)."""
    hits: list[str] = []
    for name, pattern, replacement in _PATTERNS:
        text, count = pattern.subn(replacement, text)
        if count:
            hits.append(name)
    return text, hits


def redact(text: str) -> str:
    """Scrub secret-shaped values out of *text*. Idempotent."""
    return _redact_with_hits(text)[0]


def scan_secrets(text: str) -> list[str]:
    """Names of redaction patterns that would fire on *text*, without altering it.

    Used by the observer to scan harvested container logs for leaked secrets.
    """
    return _redact_with_hits(text)[1]


# Subscribers notified when a redaction fires (i.e. something tried to log a
# secret). Callbacks MUST NOT log — they run inside the logging pipeline.
_redaction_callbacks: list[Callable[[dict], None]] = []
_redaction_count = 0
_count_lock = threading.Lock()
_notifying = threading.local()


def on_redaction(callback: Callable[[dict], None]) -> None:
    """Subscribe to redaction firings. Payload: {"logger": str, "patterns": [str]}."""
    if callback not in _redaction_callbacks:
        _redaction_callbacks.append(callback)


def redaction_count() -> int:
    """Total redactions since process start."""
    return _redaction_count


def _notify_redaction(logger_name: str, patterns: list[str]) -> None:
    global _redaction_count
    with _count_lock:
        _redaction_count += len(patterns)
    # A callback that logs would re-enter the filter; the thread-local guard
    # breaks that cycle instead of recursing.
    if getattr(_notifying, "active", False):
        return
    _notifying.active = True
    try:
        for callback in list(_redaction_callbacks):
            try:
                callback({"logger": logger_name, "patterns": list(patterns)})
            except Exception:  # noqa: BLE001 - callbacks must never break logging
                pass
    finally:
        _notifying.active = False


class RedactionFilter(logging.Filter):
    """Masks secrets in the rendered message before any handler emits it.

    Attached to handlers, not the logger: logger-level filters only see records
    logged directly on that logger, while handler filters see every record the
    handler processes — including all ``dvd.*`` children.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except (TypeError, ValueError):  # bad %-format args — let logging surface it
            return True
        cleaned, hits = _redact_with_hits(message)
        if hits:
            record.msg = cleaned
            record.args = ()
            _notify_redaction(record.name, hits)
        return True


# ── Configuration ────────────────────────────────────────────────────────────

# Root logger configuration happens exactly once via this flag.
_configured = False


def _prune_old_logs(now: float | None = None) -> int:
    """Delete log files older than SMG_LOG_RETENTION_DAYS. Returns count removed."""
    if _RETENTION_DAYS <= 0:
        return 0
    cutoff = (now if now is not None else time.time()) - _RETENTION_DAYS * 86400
    deleted = 0
    for pattern in ("smuggler_*.log*", "dvd_*.log*"):
        for path in _LOGS_DIR.glob(pattern):
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink()
                    deleted += 1
            except OSError:
                continue
    return deleted


def _configure() -> None:
    global _configured
    if _configured:
        return
    _configured = True

    root = logging.getLogger("dvd")
    root.setLevel(_LEVEL)
    root.propagate = False

    if not _ENABLED:
        root.addHandler(logging.NullHandler())
        return

    redaction = RedactionFilter()

    # Console handler — WARNING+ so normal output stays readable.
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(max(_LEVEL, logging.WARNING))
    console.setFormatter(_FMT)
    console.addFilter(redaction)
    root.addHandler(console)

    if not _FILE_ENABLED:
        return

    # File handler — full verbosity at configured level, size-capped.
    _LOGS_DIR.mkdir(parents=True, exist_ok=True)
    pruned = _prune_old_logs()
    fh = logging.handlers.RotatingFileHandler(
        _LOG_FILE, maxBytes=_MAX_BYTES, backupCount=_BACKUP_COUNT, encoding="utf-8",
    )
    fh.setLevel(_LEVEL)
    fh.setFormatter(_FMT)
    fh.addFilter(redaction)
    root.addHandler(fh)
    if pruned:
        root.info("log retention: removed %d file(s) older than %d days", pruned, _RETENTION_DAYS)


def get_logger(name: str) -> logging.Logger:
    """
    Return a child logger under the 'dvd' hierarchy.

    Usage::
        from cli.log import get_logger
        log = get_logger(__name__)
    """
    _configure()
    return logging.getLogger(f"dvd.{name}")


def log_file_path() -> Path | None:
    """Return the active log file path, or None if file logging is disabled."""
    return _LOG_FILE if _FILE_ENABLED else None


def log_safe(value: object) -> str:
    """Strip CR/LF from a value before logging to prevent log injection (S5145)."""
    return str(value).replace('\r', '').replace('\n', '')
