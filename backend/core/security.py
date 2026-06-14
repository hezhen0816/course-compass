from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

try:
    from .errors import CredentialStoreError
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from core.errors import CredentialStoreError


PLACEHOLDER_VALUES = {
    "replace-with-a-long-random-secret",
    "replace-with-openssl-rand-hex-32",
    "your-anon-key",
    "your-publishable-or-anon-key",
    "your-service-role-key",
}


def is_placeholder(value: str) -> bool:
    normalized = value.strip().lower()
    return not normalized or normalized in PLACEHOLDER_VALUES


def require_public_supabase_config(supabase_url: str, supabase_anon_key: str) -> None:
    if not supabase_url or is_placeholder(supabase_anon_key):
        raise CredentialStoreError("後端尚未設定 Supabase publishable/anon key，無法保存校務帳密。")


def require_service_supabase_config(supabase_url: str, supabase_service_role_key: str) -> None:
    if not supabase_url or is_placeholder(supabase_service_role_key):
        raise CredentialStoreError("後端尚未設定 Supabase service role key，無法保存校務帳密。")


def fernet_for_secret(secret: str) -> Fernet:
    secret = secret.strip()
    if is_placeholder(secret):
        raise CredentialStoreError("後端尚未設定校務帳密加密金鑰。")
    if len(secret) < 32:
        raise CredentialStoreError("校務帳密加密金鑰長度不足，請設定至少 32 字元的隨機字串。")
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_sensitive_value(value: str, secret: str) -> str:
    return fernet_for_secret(secret).encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_sensitive_value(token: str, secret: str) -> str:
    try:
        return fernet_for_secret(secret).decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise CredentialStoreError("已保存的敏感資料無法解密，請重新保存。") from exc


def supabase_headers(
    supabase_anon_key: str,
    supabase_service_role_key: str,
    *,
    json_body: bool = False,
    bearer_token: str | None = None,
) -> dict[str, str]:
    api_key = supabase_anon_key if bearer_token else supabase_service_role_key
    if is_placeholder(api_key):
        api_key = supabase_anon_key if not is_placeholder(supabase_anon_key) else supabase_service_role_key
    headers = {
        "apikey": api_key,
        "Authorization": f"Bearer {bearer_token or supabase_service_role_key}",
        "Accept": "application/json",
    }
    if json_body:
        headers["Content-Type"] = "application/json"
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
    return headers


def service_role_headers(
    supabase_url: str,
    supabase_service_role_key: str,
    *,
    json_body: bool = False,
) -> dict[str, str]:
    require_service_supabase_config(supabase_url, supabase_service_role_key)
    headers = {
        "apikey": supabase_service_role_key,
        "Authorization": f"Bearer {supabase_service_role_key}",
        "Accept": "application/json",
    }
    if json_body:
        headers["Content-Type"] = "application/json"
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
    return headers
