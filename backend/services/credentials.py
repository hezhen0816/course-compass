from __future__ import annotations

from collections.abc import Callable
from typing import Any

CredentialRowLoader = Callable[[str], dict[str, Any] | None]
CredentialRowUpserter = Callable[[str, str, str], None]
CredentialRowDeleter = Callable[[str], None]
ContentLoader = Callable[[str, str | None], dict[str, Any]]
ContentSaver = Callable[[str, dict[str, Any], str | None], None]
PasswordEncryptor = Callable[[str], str]
PasswordDecryptor = Callable[[str], str]


def settings(content: dict[str, Any]) -> dict[str, Any]:
    payload = content.get("settings")
    if not isinstance(payload, dict):
        payload = {}
        content["settings"] = payload
    return payload


def legacy_school_credentials_status(
    user_id: str,
    access_token: str | None,
    load_user_content: ContentLoader,
) -> dict[str, Any]:
    content = load_user_content(user_id, access_token)
    payload = settings(content)
    credentials = payload.get("schoolCredentials")
    fallback_username = str(payload.get("school_account") or "")
    plaintext_password = str(payload.get("school_password") or "")
    if not isinstance(credentials, dict):
        return {"username": fallback_username, "hasPassword": bool(plaintext_password)}
    username = str(credentials.get("username") or fallback_username)
    encrypted_password = str(credentials.get("passwordCiphertext") or "")
    if not encrypted_password and not plaintext_password:
        return {"username": username, "hasPassword": False}
    return {
        "username": username,
        "hasPassword": True,
    }


def legacy_school_credentials_secret(
    user_id: str,
    access_token: str | None,
    load_user_content: ContentLoader,
    decrypt_school_password: PasswordDecryptor,
) -> dict[str, Any]:
    content = load_user_content(user_id, access_token)
    payload = settings(content)
    credentials = payload.get("schoolCredentials")
    fallback_username = str(payload.get("school_account") or "")
    plaintext_password = str(payload.get("school_password") or "")
    if not isinstance(credentials, dict):
        return {
            "username": fallback_username,
            "password": plaintext_password,
            "hasPassword": bool(plaintext_password),
        }
    username = str(credentials.get("username") or fallback_username)
    encrypted_password = str(credentials.get("passwordCiphertext") or "")
    if not encrypted_password and not plaintext_password:
        return {"username": username, "password": "", "hasPassword": False}
    if plaintext_password:
        return {
            "username": username,
            "password": plaintext_password,
            "hasPassword": True,
        }
    return {
        "username": username,
        "password": decrypt_school_password(encrypted_password),
        "hasPassword": True,
    }


def promote_legacy_school_credentials(
    user_id: str,
    username: str,
    password: str,
    access_token: str | None,
    encrypt_school_password: PasswordEncryptor,
    upsert_school_credentials_row: CredentialRowUpserter,
    load_user_content: ContentLoader,
    save_user_content: ContentSaver,
) -> None:
    if not password:
        return
    encrypted_password = encrypt_school_password(password)
    upsert_school_credentials_row(user_id, username, encrypted_password)
    content = load_user_content(user_id, access_token)
    payload = settings(content)
    payload["school_account"] = username
    payload.pop("schoolCredentials", None)
    payload.pop("school_password", None)
    save_user_content(user_id, content, access_token)


def get_school_credentials_status(
    user_id: str,
    access_token: str | None,
    load_school_credentials_row: CredentialRowLoader,
    read_legacy_status: Callable[[str, str | None], dict[str, Any]],
    ignored_exceptions: tuple[type[BaseException], ...],
) -> dict[str, Any]:
    try:
        row = load_school_credentials_row(user_id)
    except ignored_exceptions:
        row = None
    if row:
        return {
            "username": str(row.get("school_account") or ""),
            "hasPassword": bool(row.get("password_ciphertext")),
        }
    return read_legacy_status(user_id, access_token)


def get_school_credentials_secret(
    user_id: str,
    access_token: str | None,
    load_school_credentials_row: CredentialRowLoader,
    read_legacy_secret: Callable[[str, str | None], dict[str, Any]],
    promote_legacy_credentials: Callable[[str, str, str, str | None], None],
    decrypt_school_password: PasswordDecryptor,
    ignored_exceptions: tuple[type[BaseException], ...],
) -> dict[str, Any]:
    try:
        row = load_school_credentials_row(user_id)
    except ignored_exceptions:
        row = None
    if not row:
        legacy = read_legacy_secret(user_id, access_token)
        if legacy.get("hasPassword"):
            try:
                promote_legacy_credentials(
                    user_id,
                    str(legacy.get("username") or ""),
                    str(legacy.get("password") or ""),
                    access_token,
                )
            except ignored_exceptions:
                pass
        return legacy
    username = str(row.get("school_account") or "")
    encrypted_password = str(row.get("password_ciphertext") or "")
    if not encrypted_password:
        return {"username": username, "password": "", "hasPassword": False}
    return {
        "username": username,
        "password": decrypt_school_password(encrypted_password),
        "hasPassword": True,
    }


def put_school_credentials(
    user_id: str,
    username: str,
    password: str,
    access_token: str | None,
    encrypt_school_password: PasswordEncryptor,
    upsert_school_credentials_row: CredentialRowUpserter,
    load_user_content: ContentLoader,
    save_user_content: ContentSaver,
) -> dict[str, Any]:
    encrypted_password = encrypt_school_password(password)
    upsert_school_credentials_row(user_id, username, encrypted_password)
    content = load_user_content(user_id, access_token)
    payload = settings(content)
    payload["school_account"] = username
    payload.pop("schoolCredentials", None)
    payload.pop("school_password", None)
    save_user_content(user_id, content, access_token)
    return {"username": username, "hasPassword": True}


def delete_school_credentials(
    user_id: str,
    access_token: str | None,
    delete_school_credentials_row: CredentialRowDeleter,
    load_user_content: ContentLoader,
    save_user_content: ContentSaver,
) -> dict[str, Any]:
    delete_school_credentials_row(user_id)
    content = load_user_content(user_id, access_token)
    payload = settings(content)
    username = str(payload.get("school_account") or "")
    payload.pop("schoolCredentials", None)
    payload.pop("school_password", None)
    save_user_content(user_id, content, access_token)
    return {"username": username, "hasPassword": False}
