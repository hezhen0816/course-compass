from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

try:
    from ..credentials import CredentialStoreError
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from credentials import CredentialStoreError


SessionRowLoader = Callable[[str, str], dict[str, Any] | None]
SessionRowSaver = Callable[[str, str, str, str, str], None]
SessionRowDeleter = Callable[[str, str | None], None]
SensitiveEncryptor = Callable[[str], str]
SensitiveDecryptor = Callable[[str], str]
SessionStateEncryptor = Callable[[dict[str, Any]], str]
SessionStateDecryptor = Callable[[str], dict[str, Any]]
NowFactory = Callable[[], datetime]


def official_session_expires_at(ttl_seconds: int, now: NowFactory) -> datetime:
    return now() + timedelta(seconds=ttl_seconds)


def encrypt_school_session_state(
    session_state: dict[str, Any],
    encrypt_sensitive_value: SensitiveEncryptor,
) -> str:
    raw = json.dumps(session_state, ensure_ascii=True, separators=(",", ":"))
    return encrypt_sensitive_value(raw)


def decrypt_school_session_state(
    ciphertext: str,
    decrypt_sensitive_value: SensitiveDecryptor,
) -> dict[str, Any]:
    try:
        payload = json.loads(decrypt_sensitive_value(ciphertext))
    except json.JSONDecodeError as exc:
        raise CredentialStoreError("已保存的官方選課 session 格式無法解析，請重新同步。") from exc
    if not isinstance(payload, dict):
        raise CredentialStoreError("已保存的官方選課 session 格式錯誤，請重新同步。")
    return payload


def load_school_session_state(
    user_id: str,
    username: str,
    load_session_row: SessionRowLoader,
    decrypt_session_state: SessionStateDecryptor,
) -> dict[str, Any] | None:
    if not username.strip():
        return None
    row = load_session_row(user_id, username)
    if row is None:
        return None
    ciphertext = str(row.get("session_ciphertext") or "")
    if not ciphertext:
        return None
    return {
        "school_account": str(row.get("school_account") or username),
        "session_state": decrypt_session_state(ciphertext),
        "expires_at": row.get("expires_at"),
        "last_keep_alive_at": row.get("last_keep_alive_at"),
    }


def save_school_session_state(
    user_id: str,
    username: str,
    session_state: dict[str, Any],
    save_session_row: SessionRowSaver,
    encrypt_session_state: SessionStateEncryptor,
    default_expires_at: NowFactory,
    now: NowFactory,
    *,
    expires_at: datetime | None = None,
    last_keep_alive_at: datetime | None = None,
) -> None:
    if not username.strip():
        return
    save_session_row(
        user_id,
        username,
        encrypt_session_state(session_state),
        (expires_at or default_expires_at()).isoformat(),
        (last_keep_alive_at or now()).isoformat(),
    )


def delete_school_session(
    user_id: str,
    username: str | None,
    delete_session_row: SessionRowDeleter,
) -> None:
    delete_session_row(user_id, username)
