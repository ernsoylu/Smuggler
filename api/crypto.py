"""Symmetric encryption for secrets at rest (e.g. OpenVPN passwords).

Keyed off the ``SMG_SECRET_KEY`` environment variable. The raw env value may be
any string — a stable Fernet key is derived from it so operators don't have to
hand-generate a url-safe base64 key.

Key derivation is **scrypt** (v2). The original scheme was a bare unsalted
SHA-256 (v1), which could be brute-forced at raw hash speed against any captured
ciphertext — fine for the high-entropy key ``setup.sh`` generates, but no
protection at all for a hand-chosen passphrase. Both keys are kept in a
:class:`MultiFernet`, so v1 ciphertext still decrypts while everything new is
written under v2; ``init_db`` rotates old rows in place.

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
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from cli.log import get_logger

log = get_logger(__name__)

_PREFIX = "fernet:"
_BPREFIX = b"fernet:"
_ENV_VAR = "SMG_SECRET_KEY"
_SALT_VAR = "SMG_SECRET_SALT"
_OPT_OUT_VAR = "SMG_ALLOW_PLAINTEXT_SECRETS"

# scrypt cost. ~16 MiB and ~50-100 ms per derivation, which is negligible when
# cached per process but expensive enough to make offline guessing impractical.
_SCRYPT_N = 2 ** 14
_SCRYPT_R = 8
_SCRYPT_P = 1

# Used when SMG_SECRET_SALT is unset. Deployments created before the salt
# existed must keep deriving the same key, so this value can never change.
# setup.sh writes a random per-deployment salt for new installs; a fixed salt
# only forfeits resistance to precomputation shared across deployments, which
# scrypt's cost already makes impractical.
_DEFAULT_SALT = b"smuggler.fernet.v2"

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


def _configured_salt() -> bytes:
    raw = os.environ.get(_SALT_VAR, "").strip()
    return raw.encode("utf-8") if raw else _DEFAULT_SALT


@lru_cache(maxsize=32)
def _derive_v2(secret: str, salt: bytes) -> bytes:
    """scrypt-derived Fernet key. Cached — the KDF is deliberately expensive."""
    kdf = Scrypt(salt=salt, length=32, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P)
    return base64.urlsafe_b64encode(kdf.derive(secret.encode("utf-8")))


@lru_cache(maxsize=32)
def _derive_v1(secret: str) -> bytes:
    """Legacy unsalted SHA-256 key — decrypt-only, never used for new writes."""
    return base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())


def _fernet_chain(secret: str) -> MultiFernet:
    """Keys in priority order: current v2, default-salt v2, then legacy v1.

    ``MultiFernet`` encrypts with the first key and decrypts with whichever
    works, so a deployment that later gains a ``SMG_SECRET_SALT`` can still read
    rows written under the default salt.
    """
    salt = _configured_salt()
    keys = [Fernet(_derive_v2(secret, salt))]
    if salt != _DEFAULT_SALT:
        keys.append(Fernet(_derive_v2(secret, _DEFAULT_SALT)))
    keys.append(Fernet(_derive_v1(secret)))
    return MultiFernet(keys)


def _get_fernet() -> MultiFernet | None:
    """Build the key chain from ``SMG_SECRET_KEY``, or ``None`` if it is not set.

    Read from the environment on each call so tests and runtime reconfiguration
    see changes; the expensive part (key derivation) is cached separately.
    """
    secret = os.environ.get(_ENV_VAR, "").strip()
    if not secret:
        return None
    return _fernet_chain(secret)


def _primary_fernet() -> Fernet | None:
    """Just the current v2 key — used to tell fresh ciphertext from legacy."""
    secret = os.environ.get(_ENV_VAR, "").strip()
    if not secret:
        return None
    return Fernet(_derive_v2(secret, _configured_salt()))


def encryption_enabled() -> bool:
    """True when a secret key is configured and encryption is active."""
    return _get_fernet() is not None


def weak_key_reason() -> str | None:
    """Describe why ``SMG_SECRET_KEY`` looks weak, or ``None`` if it looks fine.

    scrypt makes guessing costly but cannot rescue a genuinely trivial secret,
    so this is surfaced as a startup warning.
    """
    secret = os.environ.get(_ENV_VAR, "").strip()
    if not secret:
        return None
    if len(secret) < 16:
        return f"only {len(secret)} characters long (want at least 16)"
    if len(set(secret)) < 8:
        return f"only {len(set(secret))} distinct characters"
    return None


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


# ─── v1 → v2 rotation ─────────────────────────────────────────────────────────

def needs_rekey(value: str | bytes | None) -> bool:
    """True when an encrypted value is readable but not under the current key.

    Used by ``init_db`` to rotate legacy v1 (unsalted SHA-256) ciphertext onto
    the scrypt key without touching rows that are already current.
    """
    if isinstance(value, str):
        if not is_encrypted(value):
            return False
        token = value[len(_PREFIX):].encode("ascii")
    elif value:
        if not is_encrypted_bytes(value):
            return False
        token = bytes(value)[len(_BPREFIX):]
    else:
        return False

    primary = _primary_fernet()
    if primary is None:
        return False
    try:
        primary.decrypt(token)
        return False  # already under the current key
    except InvalidToken:
        # Only worth rotating if some key in the chain can actually read it.
        chain = _get_fernet()
        if chain is None:
            return False
        try:
            chain.decrypt(token)
            return True
        except InvalidToken:
            return False


def rekey(value: str | None) -> str | None:
    """Re-encrypt a text secret under the current key. Assumes it is readable."""
    plain = decrypt(value)
    if plain is None:
        return value
    fernet = _get_fernet()
    if fernet is None:
        return value
    return _PREFIX + fernet.encrypt(plain.encode("utf-8")).decode("ascii")


def rekey_bytes(value: bytes | None) -> bytes | None:
    """Re-encrypt a binary secret under the current key. Assumes it is readable."""
    plain = decrypt_bytes(value)
    if plain is None:
        return value
    fernet = _get_fernet()
    if fernet is None:
        return value
    return _BPREFIX + fernet.encrypt(plain)
