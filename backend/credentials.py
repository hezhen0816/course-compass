from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import requests
from cryptography.fernet import Fernet, InvalidToken

try:
    from .core.errors import CredentialStoreError
    from .core.config import (
        DEFAULT_TIMEOUT,
        SCHOOL_CREDENTIALS_ENCRYPTION_SECRET,
        SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_URL,
    )
    from .repositories import credentials as credential_repository
    from .services import credentials as credential_service
except ImportError:  # pragma: no cover
    from core.errors import CredentialStoreError
    from core.config import (
        DEFAULT_TIMEOUT,
        SCHOOL_CREDENTIALS_ENCRYPTION_SECRET,
        SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_URL,
    )
    from repositories import credentials as credential_repository
    from services import credentials as credential_service


PLACEHOLDER_VALUES = {
    "replace-with-a-long-random-secret",
    "replace-with-openssl-rand-hex-32",
    "your-anon-key",
    "your-publishable-or-anon-key",
    "your-service-role-key",
}


def _is_placeholder(value: str) -> bool:
    normalized = value.strip().lower()
    return not normalized or normalized in PLACEHOLDER_VALUES


def _require_public_supabase_config() -> None:
    if not SUPABASE_URL or _is_placeholder(SUPABASE_ANON_KEY):
        raise CredentialStoreError("後端尚未設定 Supabase publishable/anon key，無法保存校務帳密。")


def _require_service_supabase_config() -> None:
    if not SUPABASE_URL or _is_placeholder(SUPABASE_SERVICE_ROLE_KEY):
        raise CredentialStoreError("後端尚未設定 Supabase service role key，無法保存校務帳密。")


def _fernet() -> Fernet:
    secret = SCHOOL_CREDENTIALS_ENCRYPTION_SECRET.strip()
    if _is_placeholder(secret):
        raise CredentialStoreError("後端尚未設定校務帳密加密金鑰。")
    if len(secret) < 32:
        raise CredentialStoreError("校務帳密加密金鑰長度不足，請設定至少 32 字元的隨機字串。")
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_sensitive_value(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_sensitive_value(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise CredentialStoreError("已保存的敏感資料無法解密，請重新保存。") from exc


def encrypt_school_password(password: str) -> str:
    return encrypt_sensitive_value(password)


def decrypt_school_password(token: str) -> str:
    try:
        return decrypt_sensitive_value(token)
    except CredentialStoreError as exc:
        raise CredentialStoreError("已保存的校務密碼無法解密，請重新保存帳密。") from exc


def _supabase_headers(*, json_body: bool = False, bearer_token: str | None = None) -> dict[str, str]:
    api_key = SUPABASE_ANON_KEY if bearer_token else SUPABASE_SERVICE_ROLE_KEY
    if _is_placeholder(api_key):
        api_key = SUPABASE_ANON_KEY if not _is_placeholder(SUPABASE_ANON_KEY) else SUPABASE_SERVICE_ROLE_KEY
    headers = {
        "apikey": api_key,
        "Authorization": f"Bearer {bearer_token or SUPABASE_SERVICE_ROLE_KEY}",
        "Accept": "application/json",
    }
    if json_body:
        headers["Content-Type"] = "application/json"
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
    return headers


def _service_role_headers(*, json_body: bool = False) -> dict[str, str]:
    _require_service_supabase_config()
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Accept": "application/json",
    }
    if json_body:
        headers["Content-Type"] = "application/json"
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
    return headers


def resolve_user_id(access_token: str) -> str:
    if not SUPABASE_URL:
        raise CredentialStoreError("後端尚未設定 Supabase URL，無法驗證登入狀態。")
    api_key = SUPABASE_ANON_KEY
    if _is_placeholder(api_key):
        _require_service_supabase_config()
        api_key = SUPABASE_SERVICE_ROLE_KEY
    response = requests.get(
        f"{SUPABASE_URL}/auth/v1/user",
        headers={
            "apikey": api_key,
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        },
        timeout=DEFAULT_TIMEOUT,
    )
    if response.status_code in {401, 403}:
        raise CredentialStoreError("登入狀態已過期或無效，請重新登入。")
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise CredentialStoreError("Supabase 使用者驗證回傳格式錯誤，請重新登入。")
    user_id = str(payload.get("id") or "")
    if not user_id:
        raise CredentialStoreError("無法驗證目前登入使用者。")
    return user_id


def load_user_content(user_id: str, access_token: str | None = None) -> dict[str, Any]:
    _require_public_supabase_config()
    endpoint = (
        f"{SUPABASE_URL}/rest/v1/user_data"
        f"?user_id=eq.{quote(user_id, safe='')}&select=content"
    )
    response = requests.get(endpoint, headers=_supabase_headers(bearer_token=access_token), timeout=DEFAULT_TIMEOUT)
    response.raise_for_status()
    rows = response.json()
    if not rows:
        return {"schemaVersion": 2, "settings": {}}
    content = rows[0].get("content")
    return content if isinstance(content, dict) else {"schemaVersion": 2, "settings": {}}


def save_user_content(user_id: str, content: dict[str, Any], access_token: str | None = None) -> None:
    _require_public_supabase_config()
    body = {
        "user_id": user_id,
        "content": content,
        "content_version": 2,
        "last_writer": "backend",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    response = requests.post(
        f"{SUPABASE_URL}/rest/v1/user_data?on_conflict=user_id",
        headers=_supabase_headers(json_body=True, bearer_token=access_token),
        json=body,
        timeout=DEFAULT_TIMEOUT,
    )
    response.raise_for_status()


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
