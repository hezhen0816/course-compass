from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import requests

try:
    from ..core.config import (
        DEFAULT_TIMEOUT,
        SCHOOL_CREDENTIALS_ENCRYPTION_SECRET,
        SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_URL,
    )
    from ..core import security
    from ..core.errors import CredentialStoreError
    from ..repositories import credentials as credential_repository
    from . import credentials as credential_service
except ImportError:  # pragma: no cover
    from core.config import (
        DEFAULT_TIMEOUT,
        SCHOOL_CREDENTIALS_ENCRYPTION_SECRET,
        SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_URL,
    )
    from core import security
    from core.errors import CredentialStoreError
    from repositories import credentials as credential_repository
    from services import credentials as credential_service


PLACEHOLDER_VALUES = security.PLACEHOLDER_VALUES


def _is_placeholder(value: str) -> bool:
    return security.is_placeholder(value)


def _require_public_supabase_config() -> None:
    security.require_public_supabase_config(SUPABASE_URL, SUPABASE_ANON_KEY)


def _require_service_supabase_config() -> None:
    security.require_service_supabase_config(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def encrypt_sensitive_value(value: str) -> str:
    return security.encrypt_sensitive_value(value, SCHOOL_CREDENTIALS_ENCRYPTION_SECRET)


def decrypt_sensitive_value(token: str) -> str:
    return security.decrypt_sensitive_value(token, SCHOOL_CREDENTIALS_ENCRYPTION_SECRET)


def encrypt_school_password(password: str) -> str:
    return encrypt_sensitive_value(password)


def decrypt_school_password(token: str) -> str:
    try:
        return decrypt_sensitive_value(token)
    except CredentialStoreError as exc:
        raise CredentialStoreError("已保存的校務密碼無法解密，請重新保存帳密。") from exc


def _supabase_headers(*, json_body: bool = False, bearer_token: str | None = None) -> dict[str, str]:
    return security.supabase_headers(
        SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY,
        json_body=json_body,
        bearer_token=bearer_token,
    )


def _service_role_headers(*, json_body: bool = False) -> dict[str, str]:
    return security.service_role_headers(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, json_body=json_body)


def resolve_user_id(access_token: str) -> str:
    if not SUPABASE_URL:
        raise CredentialStoreError("後端尚未設定 Supabase URL，無法驗證登入狀態。")
    api_key = SUPABASE_ANON_KEY
    if _is_placeholder(api_key):
        _require_service_supabase_config()
        api_key = SUPABASE_SERVICE_ROLE_KEY
    response = credential_repository.fetch_auth_user(
        access_token,
        supabase_url=SUPABASE_URL,
        api_key=api_key,
        timeout=DEFAULT_TIMEOUT,
        get=requests.get,
    )
    if response.status_code in {401, 403}:
        raise CredentialStoreError("登入狀態已過期或無效，請重新登入。")
    payload = response.json()
    if not isinstance(payload, dict):
        raise CredentialStoreError("Supabase 使用者驗證回傳格式錯誤，請重新登入。")
    user_id = str(payload.get("id") or "")
    if not user_id:
        raise CredentialStoreError("無法驗證目前登入使用者。")
    return user_id


def load_user_content(user_id: str, access_token: str | None = None) -> dict[str, Any]:
    _require_public_supabase_config()
    return credential_repository.load_user_content(
        user_id,
        supabase_url=SUPABASE_URL,
        headers=_supabase_headers(bearer_token=access_token),
        timeout=DEFAULT_TIMEOUT,
        get=requests.get,
    )


def save_user_content(user_id: str, content: dict[str, Any], access_token: str | None = None) -> None:
    _require_public_supabase_config()
    credential_repository.save_user_content(
        user_id,
        content,
        supabase_url=SUPABASE_URL,
        headers=_supabase_headers(json_body=True, bearer_token=access_token),
        timeout=DEFAULT_TIMEOUT,
        updated_at=datetime.now(timezone.utc).isoformat(),
        post=requests.post,
    )


def _settings(content: dict[str, Any]) -> dict[str, Any]:
    return credential_service.settings(content)


def _load_school_credentials_row(user_id: str) -> dict[str, Any] | None:
    return credential_repository.load_school_credentials_row(
        user_id,
        supabase_url=SUPABASE_URL,
        timeout=DEFAULT_TIMEOUT,
        service_role_headers=_service_role_headers,
        post=requests.post,
    )


def _upsert_school_credentials_row(user_id: str, username: str, password_ciphertext: str) -> None:
    credential_repository.upsert_school_credentials_row(
        user_id,
        username,
        password_ciphertext,
        key_version=1,
        last_verified_at=datetime.now(timezone.utc).isoformat(),
        supabase_url=SUPABASE_URL,
        timeout=DEFAULT_TIMEOUT,
        service_role_headers=_service_role_headers,
        post=requests.post,
    )


def _delete_school_credentials_row(user_id: str) -> None:
    credential_repository.delete_school_credentials_row(
        user_id,
        supabase_url=SUPABASE_URL,
        timeout=DEFAULT_TIMEOUT,
        service_role_headers=_service_role_headers,
        post=requests.post,
    )


def _legacy_school_credentials_status(user_id: str, access_token: str | None = None) -> dict[str, Any]:
    return credential_service.legacy_school_credentials_status(
        user_id,
        access_token,
        lambda selected_user_id, selected_access_token: load_user_content(selected_user_id, selected_access_token),
    )


def _legacy_school_credentials_secret(user_id: str, access_token: str | None = None) -> dict[str, Any]:
    return credential_service.legacy_school_credentials_secret(
        user_id,
        access_token,
        lambda selected_user_id, selected_access_token: load_user_content(selected_user_id, selected_access_token),
        lambda password_ciphertext: decrypt_school_password(password_ciphertext),
    )


def _promote_legacy_school_credentials(
    user_id: str,
    username: str,
    password: str,
    access_token: str | None = None,
) -> None:
    credential_service.promote_legacy_school_credentials(
        user_id,
        username,
        password,
        access_token,
        lambda plaintext: encrypt_school_password(plaintext),
        lambda selected_user_id, selected_username, password_ciphertext: _upsert_school_credentials_row(
            selected_user_id,
            selected_username,
            password_ciphertext,
        ),
        lambda selected_user_id, selected_access_token: load_user_content(selected_user_id, selected_access_token),
        lambda selected_user_id, content, selected_access_token: save_user_content(
            selected_user_id,
            content,
            selected_access_token,
        ),
    )


def get_school_credentials_status(user_id: str, access_token: str | None = None) -> dict[str, Any]:
    return credential_service.get_school_credentials_status(
        user_id,
        access_token,
        lambda selected_user_id: _load_school_credentials_row(selected_user_id),
        lambda selected_user_id, selected_access_token: _legacy_school_credentials_status(
            selected_user_id,
            selected_access_token,
        ),
        (CredentialStoreError, requests.RequestException),
    )


def get_school_credentials_secret(user_id: str, access_token: str | None = None) -> dict[str, Any]:
    return credential_service.get_school_credentials_secret(
        user_id,
        access_token,
        lambda selected_user_id: _load_school_credentials_row(selected_user_id),
        lambda selected_user_id, selected_access_token: _legacy_school_credentials_secret(
            selected_user_id,
            selected_access_token,
        ),
        lambda selected_user_id, username, password, selected_access_token: _promote_legacy_school_credentials(
            selected_user_id,
            username,
            password,
            selected_access_token,
        ),
        lambda password_ciphertext: decrypt_school_password(password_ciphertext),
        (CredentialStoreError, requests.RequestException),
    )


def put_school_credentials(user_id: str, username: str, password: str, access_token: str | None = None) -> dict[str, Any]:
    return credential_service.put_school_credentials(
        user_id,
        username,
        password,
        access_token,
        lambda plaintext: encrypt_school_password(plaintext),
        lambda selected_user_id, selected_username, password_ciphertext: _upsert_school_credentials_row(
            selected_user_id,
            selected_username,
            password_ciphertext,
        ),
        lambda selected_user_id, selected_access_token: load_user_content(selected_user_id, selected_access_token),
        lambda selected_user_id, content, selected_access_token: save_user_content(
            selected_user_id,
            content,
            selected_access_token,
        ),
    )


def delete_school_credentials(user_id: str, access_token: str | None = None) -> dict[str, Any]:
    return credential_service.delete_school_credentials(
        user_id,
        access_token,
        lambda selected_user_id: _delete_school_credentials_row(selected_user_id),
        lambda selected_user_id, selected_access_token: load_user_content(selected_user_id, selected_access_token),
        lambda selected_user_id, content, selected_access_token: save_user_content(
            selected_user_id,
            content,
            selected_access_token,
        ),
    )
