from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import requests

try:
    from ..core.config import (
        DEFAULT_TIMEOUT,
        SCHOOL_CREDENTIALS_ENCRYPTION_SECRET,
        SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_URL,
    )
    from ..core import security
    from ..repositories import school_sessions as school_session_repository
    from . import school_sessions as school_session_service
except ImportError:  # pragma: no cover
    from core.config import (
        DEFAULT_TIMEOUT,
        SCHOOL_CREDENTIALS_ENCRYPTION_SECRET,
        SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_URL,
    )
    from core import security
    from repositories import school_sessions as school_session_repository
    from services import school_sessions as school_session_service


OFFICIAL_SESSION_TTL_SECONDS = 25 * 60


def encrypt_sensitive_value(value: str) -> str:
    return security.encrypt_sensitive_value(value, SCHOOL_CREDENTIALS_ENCRYPTION_SECRET)


def decrypt_sensitive_value(token: str) -> str:
    return security.decrypt_sensitive_value(token, SCHOOL_CREDENTIALS_ENCRYPTION_SECRET)


def _service_role_headers(*, json_body: bool = False) -> dict[str, str]:
    return security.service_role_headers(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, json_body=json_body)


def official_session_expires_at() -> datetime:
    return school_session_service.official_session_expires_at(
        OFFICIAL_SESSION_TTL_SECONDS,
        lambda: datetime.now(timezone.utc),
    )


def encrypt_school_session_state(session_state: dict[str, Any]) -> str:
    return school_session_service.encrypt_school_session_state(
        session_state,
        lambda raw: encrypt_sensitive_value(raw),
    )


def decrypt_school_session_state(ciphertext: str) -> dict[str, Any]:
    return school_session_service.decrypt_school_session_state(
        ciphertext,
        lambda token: decrypt_sensitive_value(token),
    )


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
    return school_session_service.load_school_session_state(
        user_id,
        username,
        lambda selected_user_id, selected_username: school_session_repository.load_school_session_row(
            selected_user_id,
            selected_username,
            supabase_url=SUPABASE_URL,
            timeout=DEFAULT_TIMEOUT,
            service_role_headers=_service_role_headers,
            post=requests.post,
        ),
        lambda ciphertext: decrypt_school_session_state(ciphertext),
    )


def save_school_session_state(
    user_id: str,
    username: str,
    session_state: dict[str, Any],
    *,
    expires_at: datetime | None = None,
    last_keep_alive_at: datetime | None = None,
) -> None:
    school_session_service.save_school_session_state(
        user_id,
        username,
        session_state,
        lambda selected_user_id, selected_username, ciphertext, selected_expires_at, selected_last_keep_alive_at: (
            school_session_repository.save_school_session_row(
                selected_user_id,
                selected_username,
                ciphertext,
                expires_at=selected_expires_at,
                last_keep_alive_at=selected_last_keep_alive_at,
                supabase_url=SUPABASE_URL,
                timeout=DEFAULT_TIMEOUT,
                service_role_headers=_service_role_headers,
                post=requests.post,
            )
        ),
        lambda state: encrypt_school_session_state(state),
        lambda: official_session_expires_at(),
        lambda: datetime.now(timezone.utc),
        expires_at=expires_at,
        last_keep_alive_at=last_keep_alive_at,
    )


def delete_school_session(user_id: str, username: str | None = None) -> None:
    school_session_service.delete_school_session(
        user_id,
        username,
        lambda selected_user_id, selected_username: school_session_repository.delete_school_session_row(
            selected_user_id,
            selected_username,
            supabase_url=SUPABASE_URL,
            timeout=DEFAULT_TIMEOUT,
            service_role_headers=_service_role_headers,
            post=requests.post,
        ),
    )
