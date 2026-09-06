from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any

import requests
from fastapi import HTTPException

try:
    from ..credentials import CredentialStoreError
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from credentials import CredentialStoreError


UserContext = tuple[str, str]
UserIdResolver = Callable[[str], str]
CurrentUserResolver = Callable[[str | None], UserContext]
AuthorizationResolver = Callable[[str | None], UserContext | None]
CredentialsReader = Callable[[str, str], dict[str, Any]]
PasswordResolver = Callable[[str, str | None, str | None], str | None]
ClientFactory = Callable[[str], Any]
SessionStateLoader = Callable[[str, str], dict[str, Any] | None]
SessionStateSaver = Callable[..., None]
SessionStateDeleter = Callable[[str, str | None], None]
ExpiryFactory = Callable[[], datetime]
NowFactory = Callable[[], datetime]
SessionPersister = Callable[[UserContext | None, str, Any], None]
SessionDeleter = Callable[[UserContext | None, str | None], None]
SessionReuseHandler = Callable[[Any, str, UserContext | None, bool], bool]


def current_user_context(authorization: str | None, resolve_user_id: UserIdResolver) -> UserContext:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="請先登入後再保存校務帳密。")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="請先登入後再保存校務帳密。")
    try:
        return resolve_user_id(token), token
    except CredentialStoreError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Supabase 使用者驗證失敗：{exc}") from exc


def authorization_context(
    authorization: str | None,
    resolve_current_user: CurrentUserResolver,
) -> UserContext | None:
    if not authorization:
        return None
    return resolve_current_user(authorization)


def optional_authorization_context(
    authorization: str | None,
    resolve_authorization: AuthorizationResolver,
) -> UserContext | None:
    try:
        return resolve_authorization(authorization)
    except HTTPException:
        return None


CredentialsStatusReader = Callable[[str, str], dict[str, Any]]


def required_user_context(
    authorization: str | None,
    resolve_authorization: AuthorizationResolver,
) -> UserContext:
    """Reject requests that carry no valid Supabase session.

    Every endpoint that touches school data goes through here so that the
    profile can be bound to a cloud user instead of a caller-supplied student ID.
    """
    context = resolve_authorization(authorization)
    if context is None:
        raise HTTPException(status_code=401, detail="請先登入雲端帳號後再使用校務同步功能。")
    return context


def _saved_school_account(
    context: UserContext,
    read_credentials_status: CredentialsStatusReader,
) -> str:
    user_id, access_token = context
    try:
        status = read_credentials_status(user_id, access_token)
    except CredentialStoreError:
        return ""
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"讀取校務帳號綁定失敗：{exc}") from exc
    return str(status.get("username") or "").strip()


def assert_school_account_ownership(
    context: UserContext,
    username: str,
    read_credentials_status: CredentialsStatusReader,
) -> None:
    """A user who already bound a school account may only act on that account.

    Users without a saved account are allowed through: the school login that
    follows (with a password) is what proves ownership on first sync.
    """
    saved_username = _saved_school_account(context, read_credentials_status)
    if saved_username and saved_username.casefold() != username.strip().casefold():
        raise HTTPException(status_code=403, detail="已保存的校務帳號與本次操作帳號不同。")


def assert_owned_profile_key(
    context: UserContext,
    profile_key: str,
    read_credentials_status: CredentialsStatusReader,
) -> None:
    """Snapshot reads require a bound school account matching the profile."""
    saved_username = _saved_school_account(context, read_credentials_status)
    if not saved_username:
        raise HTTPException(status_code=403, detail="尚未綁定校務帳號，請先輸入校務帳密同步一次。")
    if saved_username.casefold() != profile_key.strip().casefold():
        raise HTTPException(status_code=403, detail="此校務帳號不屬於目前登入的使用者。")


def official_client_key(context: UserContext, username: str) -> str:
    """Scope cached official-selection clients to the cloud user, not the student ID."""
    return f"{context[0]}:{username.strip()}"


def saved_school_credentials(
    username: str,
    authorization: str | None,
    resolve_authorization: AuthorizationResolver,
    read_credentials: CredentialsReader,
    *,
    required: bool = False,
) -> tuple[str, str] | None:
    context = resolve_authorization(authorization)
    if context is None:
        if required:
            raise HTTPException(status_code=401, detail="請先登入後再使用已保存的校務帳密。")
        return None

    user_id, access_token = context
    try:
        credentials = read_credentials(user_id, access_token)
    except CredentialStoreError as exc:
        if required:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return None
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"讀取校務帳密失敗：{exc}") from exc

    saved_username = str(credentials.get("username") or "").strip()
    password = str(credentials.get("password") or "")
    if saved_username and saved_username != username:
        raise HTTPException(status_code=403, detail="已保存的校務帳號與本次操作帳號不同。")
    if not password:
        if required:
            raise HTTPException(status_code=400, detail="尚未保存校務密碼，請先輸入帳密同步一次。")
        return None
    return saved_username or username, password


def official_password(
    username: str,
    password: str | None,
    authorization: str | None,
    read_saved_credentials: Callable[[str, str | None], tuple[str, str] | None],
) -> str | None:
    if password:
        return password
    saved_credentials = read_saved_credentials(username, authorization)
    return saved_credentials[1] if saved_credentials else None


def required_school_password(
    username: str,
    password: str | None,
    authorization: str | None,
    resolve_official_password: PasswordResolver,
) -> str:
    resolved_password = resolve_official_password(username, password, authorization)
    if not resolved_password:
        raise HTTPException(status_code=400, detail="請輸入校務密碼，或先保存校務帳密後再同步。")
    return resolved_password


def persist_official_session(
    context: UserContext | None,
    username: str,
    client: Any,
    save_session_state: SessionStateSaver,
    session_expires_at: ExpiryFactory,
    now: NowFactory,
) -> None:
    if context is None:
        return
    try:
        save_session_state(
            context[0],
            username,
            client.export_session_state(),
            expires_at=session_expires_at(),
            last_keep_alive_at=now(),
        )
    except (CredentialStoreError, requests.RequestException, AttributeError, TypeError, ValueError):
        return


def delete_official_session(
    context: UserContext | None,
    username: str | None,
    delete_session: SessionStateDeleter,
) -> None:
    if context is None:
        return
    try:
        delete_session(context[0], username)
    except (CredentialStoreError, requests.RequestException):
        return


def reuse_official_session(
    client: Any,
    username: str,
    context: UserContext | None,
    verify_ssl: bool,
    persist_session: SessionPersister,
    delete_session: SessionDeleter,
    load_session_state: SessionStateLoader,
) -> bool:
    try:
        if client.keep_alive(verify_ssl):
            persist_session(context, username, client)
            return True
    except (RuntimeError, requests.RequestException, AttributeError):
        pass

    if context is None:
        return False

    try:
        saved_session = load_session_state(context[0], username)
    except (CredentialStoreError, requests.RequestException):
        return False
    if not saved_session:
        return False

    try:
        if not client.restore_session_state(saved_session["session_state"]):
            delete_session(context, username)
            return False
        if client.keep_alive(verify_ssl):
            persist_session(context, username, client)
            return True
    except (RuntimeError, requests.RequestException, AttributeError, KeyError, TypeError):
        pass

    delete_session(context, username)
    return False


def ensure_official_session(
    profile_key: str,
    username: str,
    password: str | None,
    authorization: str | None,
    verify_ssl: bool,
    get_client: ClientFactory,
    resolve_optional_authorization: AuthorizationResolver,
    reuse_session: SessionReuseHandler,
    resolve_official_password: PasswordResolver,
    persist_session: SessionPersister,
) -> Any:
    client = get_client(profile_key)
    context = resolve_optional_authorization(authorization)
    if reuse_session(client, username, context, verify_ssl):
        return client

    resolved_password = resolve_official_password(username, password, authorization)
    if resolved_password:
        client.ensure_session(username, resolved_password, verify_ssl)
        persist_session(context, username, client)
    return client


def require_official_action_confirmation(confirmed: bool) -> None:
    if not confirmed:
        raise HTTPException(status_code=400, detail="官方選課操作需要使用者明確確認後才能送出。")
