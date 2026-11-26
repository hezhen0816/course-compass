from __future__ import annotations

import base64
import hashlib
import json
import threading
import time
from datetime import datetime, timezone
from typing import Any

import requests
from cryptography.fernet import Fernet, InvalidToken

try:
    from .config import (
        DEFAULT_TIMEOUT,
        COURSE_COMPASS_ENCRYPTION_SECRET,
        SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_URL,
    )
except ImportError:  # pragma: no cover
    from config import (
        DEFAULT_TIMEOUT,
        COURSE_COMPASS_ENCRYPTION_SECRET,
        SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_URL,
    )


class CredentialStoreError(RuntimeError):
    pass


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


def _require_service_supabase_config() -> None:
    if not SUPABASE_URL or _is_placeholder(SUPABASE_SERVICE_ROLE_KEY):
        raise CredentialStoreError("後端尚未設定 Supabase service role key，無法存取使用者資料。")


def _fernet() -> Fernet:
    secret = COURSE_COMPASS_ENCRYPTION_SECRET.strip()
    if _is_placeholder(secret):
        raise CredentialStoreError("後端尚未設定加密金鑰。")
    if len(secret) < 32:
        raise CredentialStoreError("加密金鑰長度不足，請設定至少 32 字元的隨機字串。")
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_sensitive_value(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_sensitive_value(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise CredentialStoreError("已保存的敏感資料無法解密，請重新保存。") from exc


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


# 已驗證 token 的短期快取：每個請求都同步打 /auth/v1/user 既慢又吃 egress，
# Supabase 抖動時整個後端跟著失效。只快取成功結果，且不超過 JWT 本身的 exp。
USER_ID_CACHE_TTL_SECONDS = 60
_USER_ID_CACHE_MAX = 2000
_user_id_cache: dict[str, tuple[str, float]] = {}
_user_id_cache_lock = threading.Lock()


def clear_user_id_cache() -> None:
    with _user_id_cache_lock:
        _user_id_cache.clear()


def _jwt_exp(access_token: str) -> float | None:
    """Best-effort read of the JWT ``exp`` claim (no signature check; Supabase verifies)."""
    try:
        payload_b64 = access_token.split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        exp = payload.get("exp")
        return float(exp) if isinstance(exp, (int, float)) else None
    except Exception:
        return None


def _cache_key(access_token: str) -> str:
    return hashlib.sha256(access_token.encode("utf-8")).hexdigest()


def _cached_user_id(access_token: str) -> str | None:
    key = _cache_key(access_token)
    now = time.time()
    with _user_id_cache_lock:
        entry = _user_id_cache.get(key)
        if entry and entry[1] > now:
            return entry[0]
        if entry:
            _user_id_cache.pop(key, None)
    return None


def _store_user_id(access_token: str, user_id: str) -> None:
    now = time.time()
    expires = now + USER_ID_CACHE_TTL_SECONDS
    exp = _jwt_exp(access_token)
    if exp is not None:
        expires = min(expires, exp)
    if expires <= now:
        return
    with _user_id_cache_lock:
        if len(_user_id_cache) >= _USER_ID_CACHE_MAX:
            for k in [k for k, (_, e) in _user_id_cache.items() if e <= now]:
                _user_id_cache.pop(k, None)
            if len(_user_id_cache) >= _USER_ID_CACHE_MAX:
                _user_id_cache.clear()
        _user_id_cache[_cache_key(access_token)] = (user_id, expires)


def resolve_user_id(access_token: str) -> str:
    if not SUPABASE_URL:
        raise CredentialStoreError("後端尚未設定 Supabase URL，無法驗證登入狀態。")
    cached = _cached_user_id(access_token)
    if cached:
        return cached
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
    _store_user_id(access_token, user_id)
    return user_id


def _load_gpa_api_key_row(user_id: str) -> dict[str, Any] | None:
    response = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/get_gpa_api_key",
        headers=_service_role_headers(json_body=True),
        json={"p_user_id": user_id},
        timeout=DEFAULT_TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    if isinstance(rows, list):
        return rows[0] if rows else None
    return rows if isinstance(rows, dict) else None


def get_gpa_api_key_status(user_id: str) -> dict[str, Any]:
    """What the Web may know about the stored key: whether it exists, not its value."""
    try:
        row = _load_gpa_api_key_row(user_id)
    except (CredentialStoreError, requests.RequestException):
        row = None
    if not row:
        return {"enabled": False, "hasApiKey": False, "updatedAt": None}
    return {
        "enabled": bool(row.get("enabled")),
        "hasApiKey": bool(row.get("api_key_ciphertext")),
        "updatedAt": row.get("updated_at"),
    }


def get_gpa_api_key_secret(user_id: str) -> str:
    """Decrypted key for backend use only; empty when unset or disabled."""
    try:
        row = _load_gpa_api_key_row(user_id)
    except (CredentialStoreError, requests.RequestException):
        return ""
    if not row or not row.get("enabled"):
        return ""
    token = str(row.get("api_key_ciphertext") or "")
    if not token:
        return ""
    try:
        return decrypt_sensitive_value(token)
    except CredentialStoreError:
        return ""


def put_gpa_api_key(user_id: str, api_key: str, enabled: bool = True) -> dict[str, Any]:
    response = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/upsert_gpa_api_key",
        headers=_service_role_headers(json_body=True),
        json={
            "p_user_id": user_id,
            "p_api_key_ciphertext": encrypt_sensitive_value(api_key),
            "p_enabled": enabled,
            "p_key_version": 1,
        },
        timeout=DEFAULT_TIMEOUT,
    )
    response.raise_for_status()
    return {"enabled": enabled, "hasApiKey": True, "updatedAt": datetime.now(timezone.utc).isoformat()}


def delete_gpa_api_key(user_id: str) -> dict[str, Any]:
    response = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/delete_gpa_api_key",
        headers=_service_role_headers(json_body=True),
        json={"p_user_id": user_id},
        timeout=DEFAULT_TIMEOUT,
    )
    response.raise_for_status()
    return {"enabled": False, "hasApiKey": False, "updatedAt": None}
