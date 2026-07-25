"""
Shared logging setup for Smuggler (CLI + API).

Reads from environment / .env file:
  SMG_LOGGING   true | false  (default: true)
  SMG_LOG_LEVEL DEBUG | INFO | WARNING | ERROR  (default: INFO)

The pre-rebrand ``DVD_*`` names are still honoured as a fallback so existing
.env files keep working.

A single log file is created per process start:
  logs/smuggler_YYYY-MM-DD_HH-MM-SS.log
"""

from __future__ import annotations

import logging
import os
import sys
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


_ENABLED: bool = _env("LOGGING", "true").strip().lower() not in ("false", "0", "no", "off")
_LEVEL_STR: str = _env("LOG_LEVEL", "INFO").strip().upper()
_LEVEL: int = getattr(logging, _LEVEL_STR, logging.INFO)

_FMT = logging.Formatter(
    fmt="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

# Root logger configuration happens exactly once via this flag.
_configured = False


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

    # Console handler — WARNING+ so normal output stays readable.
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(max(_LEVEL, logging.WARNING))
    console.setFormatter(_FMT)
    root.addHandler(console)

    # File handler — full verbosity at configured level.
    _LOGS_DIR.mkdir(parents=True, exist_ok=True)
    fh = logging.FileHandler(_LOG_FILE, encoding="utf-8")
    fh.setLevel(_LEVEL)
    fh.setFormatter(_FMT)
    root.addHandler(fh)


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
    """Return the active log file path, or None if logging is disabled."""
    return _LOG_FILE if _ENABLED else None


def log_safe(value: object) -> str:
    """Strip CR/LF from a value before logging to prevent log injection (S5145)."""
    return str(value).replace('\r', '').replace('\n', '')
