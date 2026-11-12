"""Shared key for the Next.js server.

A phone must not call the scoring endpoint. The learning app keeps this key
in a server environment variable and sends it on each request. The value is
never written into an error, a log line, or the response.

Local development can read the same key from the repository `.env` file,
which is gitignored. An existing environment variable wins, so a deploy can
set the key without that file.
"""

from __future__ import annotations

import hashlib
import hmac
import os
from pathlib import Path

HEADER_NAME = "X-Risk-Service-Key"
ENV_NAME = "RISK_SERVICE_API_KEY"


def read_api_key(explicit: str | None = None, env_file: Path | None = None) -> str:
    """Return the configured key, or an empty string when it is not set."""
    if explicit is not None:
        return explicit.strip()
    configured = os.environ.get(ENV_NAME, "").strip()
    if configured:
        return configured
    return _key_from_file(env_file if env_file is not None else _default_env_file())


def keys_match(provided: str, expected: str) -> bool:
    """Compare two keys without copying either value into a message."""
    if not expected or not provided:
        return False
    # Hashing first keeps a different length from changing the comparison.
    left = hashlib.sha256(provided.encode("utf-8")).digest()
    right = hashlib.sha256(expected.encode("utf-8")).digest()
    return hmac.compare_digest(left, right)


def _default_env_file() -> Path:
    # app/service_auth.py -> services/risk_engine -> services -> repository root
    return Path(__file__).resolve().parents[3] / ".env"


def _key_from_file(path: Path) -> str:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return ""
    # Read only this one name. Other lines can hold unrelated secrets.
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        if name.strip() != ENV_NAME:
            continue
        return _unquote(value.strip())
    return ""


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value
