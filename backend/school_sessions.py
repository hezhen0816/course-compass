from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

try:
    from .config import DEFAULT_TIMEOUT, SUPABASE_URL
    from .credentials import (
        CredentialStoreError,
        decrypt_sensitive_value,
        encrypt_sensitive_value,
        _service_role_headers,
    )
    from .repositories import school_sessions as school_session_repository
except ImportError:  # pragma: no cover
    from config import DEFAULT_TIMEOUT, SUPABASE_URL
    from credentials import (
        CredentialStoreError,
        decrypt_sensitive_value,
        encrypt_sensitive_value,
        _service_role_headers,
    )
    from repositories import school_sessions as school_session_repository


OFFICIAL_SESSION_TTL_SECONDS = 25 * 60


def official_session_expires_at() -> datetime:
    return datetime.now(timezone.utc) + timedelta(seconds=OFFICIAL_SESSION_TTL_SECONDS)


def encrypt_school_session_state(session_state: dict[str, Any]) -> str:
    raw = json.dumps(session_state, ensure_ascii=True, separators=(",", ":"))
    return encrypt_sensitive_value(raw)


def decrypt_school_session_state(ciphertext: str) -> dict[str, Any]:
    try:
        payload = json.loads(decrypt_sensitive_value(ciphertext))
    except json.JSONDecodeError as exc:
        raise CredentialStoreError("已保存的官方選課 session 格式無法解析，請重新同步。") from exc
    if not isinstance(payload, dict):
        raise CredentialStoreError("已保存的官方選課 session 格式錯誤，請重新同步。")
    return payload


def _post_rpc(name: str, payload: dict[str, Any]) -> requests.Response:
    return school_session_repository.post_rpc(
        name,
        payload,
        supabase_url=SUPABASE_URL,
        timeout=DEFAULT_TIMEOUT,
        service_role_headers=_service_role_headers,
        post=requests.post,
    )


def load_school_session_state(user_id: str, username: str) -> dict[str, Any] | None:
    if not username.strip():
        return None
    row = school_session_repository.load_school_session_row(
        user_id,
        username,
        supabase_url=SUPABASE_URL,
        timeout=DEFAULT_TIMEOUT,
        service_role_headers=_service_role_headers,
        post=requests.post,
    )
    if row is None:
        return None
    ciphertext = str(row.get("session_ciphertext") or "")
    if not ciphertext:
        return None
    return {
        "school_account": str(row.get("school_account") or username),
        "session_state": decrypt_school_session_state(ciphertext),
        "expires_at": row.get("expires_at"),
        "last_keep_alive_at": row.get("last_keep_alive_at"),
    }


def save_school_session_state(
    user_id: str,
    username: str,
    session_state: dict[str, Any],
    *,
    expires_at: datetime | None = None,
    last_keep_alive_at: datetime | None = None,
) -> None:
    if not username.strip():
        return
    school_session_repository.save_school_session_row(
        user_id,
        username,
        encrypt_school_session_state(session_state),
        expires_at=(expires_at or official_session_expires_at()).isoformat(),
        last_keep_alive_at=(last_keep_alive_at or datetime.now(timezone.utc)).isoformat(),
        supabase_url=SUPABASE_URL,
        timeout=DEFAULT_TIMEOUT,
        service_role_headers=_service_role_headers,
        post=requests.post,
    )


def delete_school_session(user_id: str, username: str | None = None) -> None:
    school_session_repository.delete_school_session_row(
        user_id,
        username,
        supabase_url=SUPABASE_URL,
        timeout=DEFAULT_TIMEOUT,
        service_role_headers=_service_role_headers,
        post=requests.post,
    )
