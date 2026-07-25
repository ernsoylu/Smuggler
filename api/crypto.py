"""Symmetric encryption for secrets at rest (e.g. OpenVPN passwords).

Keyed off the ``SMG_SECRET_KEY`` environment variable. The raw env value may be
any string — a stable Fernet key is derived from it with SHA-256 so operators
don't have to hand-generate a url-safe base64 key.

Ciphertext is stored with a ``fernet:`` prefix so legacy plaintext rows (written
before encryption existed) are unambiguously distinguishable and can be migrated
in place. Decryption stays tolerant — legacy plaintext rows are returned as-is —
but *writing* a secret without a key raises :class:`EncryptionUnavailable` rather
than silently storing WireGuard private keys and OpenVPN passwords in the clear.
Set ``SMG_ALLOW_PLAINTEXT_SECRETS=1`` to restore the old pass-through behaviour.
"""

from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

from cli.log import get_logger

log = get_logger(__name__)

_PREFIX = "fernet:"
_BPREFIX = b"fernet:"
_ENV_VAR = "SMG_SECRET_KEY"
_OPT_OUT_VAR = "SMG_ALLOW_PLAINTEXT_SECRETS"

# Ensures the "no key configured" warning is emitted at most once per process.
_warned_no_key = False


class EncryptionUnavailable(RuntimeError):
    """Raised when a secret must be stored but no encryption key is configured."""


def _plaintext_allowed() -> bool:
    """True when the operator has explicitly opted in to plaintext storage."""
    return os.environ.get(_OPT_OUT_VAR, "").strip().lower() in {"1", "true", "yes"}


def _warn_plaintext_once() -> None:
    global _warned_no_key
    if not _warned_no_key:
        log.warning(
            "%s is not set and %s is enabled — secrets are stored in PLAINTEXT.",
            _ENV_VAR, _OPT_OUT_VAR,
        )
        _warned_no_key = True


def _get_fernet() -> Fernet | None:
    """Build a Fernet from ``SMG_SECRET_KEY``, or ``None`` if it is not set.

    Not cached: the key is read from the environment on each call so tests (and
    runtime re-configuration) see changes, and SHA-256 is cheap.
    """
    secret = os.environ.get(_ENV_VAR, "").strip()
    if not secret:
        return None
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encryption_enabled() -> bool:
    """True when a secret key is configured and encryption is active."""
    return _get_fernet() is not None


def is_encrypted(value: str | None) -> bool:
    """True when ``value`` is a Smuggler-encrypted token (not legacy plaintext)."""
    return bool(value) and value.startswith(_PREFIX)


def encrypt(plaintext: str | None) -> str | None:
    """Encrypt a secret for storage.

    Returns ``None``/empty unchanged. Raises :class:`EncryptionUnavailable` when
    no key is configured, so a misconfigured deployment fails loudly instead of
    quietly persisting credentials in the clear.
    """
    if not plaintext:
        return plaintext
    if is_encrypted(plaintext):
        return plaintext  # already encrypted — do not double-wrap
    fernet = _get_fernet()
    if fernet is None:
        if _plaintext_allowed():
            _warn_plaintext_once()
            return plaintext
        raise EncryptionUnavailable(
            f"{_ENV_VAR} is not set — refusing to store a secret in plaintext. "
            f"Set {_ENV_VAR}, or set {_OPT_OUT_VAR}=1 to allow plaintext storage."
        )
    token = fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")
    return _PREFIX + token


def decrypt(value: str | None) -> str | None:
    """Decrypt a stored secret back to plaintext.

    Legacy plaintext values (no ``fernet:`` prefix) are returned unchanged so
    older rows keep working. Returns ``None`` if an encrypted value cannot be
    decrypted (missing/wrong key) rather than raising, so a bad key can't take
    the whole API down.
    """
    if not value:
        return value
    if not is_encrypted(value):
        return value  # legacy plaintext row
    fernet = _get_fernet()
    if fernet is None:
        log.error(
            "%s is not set but an encrypted secret was found — cannot decrypt.",
            _ENV_VAR,
        )
        return None
    token = value[len(_PREFIX):]
    try:
        return fernet.decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken:
        log.error("Failed to decrypt secret — wrong %s? Returning None.", _ENV_VAR)
        return None


# ─── Binary variants (for BLOBs such as VPN config bodies) ────────────────────

def is_encrypted_bytes(value: bytes | None) -> bool:
    """True when a BLOB is a Smuggler-encrypted token (not legacy plaintext)."""
    return bool(value) and bytes(value).startswith(_BPREFIX)


def encrypt_bytes(plaintext: bytes | None) -> bytes | None:
    """Encrypt a binary secret (e.g. a WireGuard/OpenVPN config) for storage.

    Mirrors :func:`encrypt` for ``bytes``, including raising
    :class:`EncryptionUnavailable` when no key is configured.
    """
    if not plaintext:
        return plaintext
    if is_encrypted_bytes(plaintext):
        return plaintext
    fernet = _get_fernet()
    if fernet is None:
        if _plaintext_allowed():
            _warn_plaintext_once()
            return plaintext
        raise EncryptionUnavailable(
            f"{_ENV_VAR} is not set — refusing to store a VPN config in plaintext. "
            f"Set {_ENV_VAR}, or set {_OPT_OUT_VAR}=1 to allow plaintext storage."
        )
    return _BPREFIX + fernet.encrypt(bytes(plaintext))


def decrypt_bytes(value: bytes | None) -> bytes | None:
    """Decrypt a stored binary secret back to plaintext bytes.

    Legacy plaintext BLOBs (no ``fernet:`` prefix) pass through unchanged.
    Returns ``None`` when an encrypted value cannot be decrypted (missing/wrong
    key) rather than raising.
    """
    if not value:
        return value
    if not is_encrypted_bytes(value):
        return value
    fernet = _get_fernet()
    if fernet is None:
        log.error(
            "%s is not set but an encrypted secret was found — cannot decrypt.",
            _ENV_VAR,
        )
        return None
    token = bytes(value)[len(_BPREFIX):]
    try:
        return fernet.decrypt(token)
    except InvalidToken:
        log.error("Failed to decrypt config body — wrong %s? Returning None.", _ENV_VAR)
        return None
