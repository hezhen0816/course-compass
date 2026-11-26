from __future__ import annotations

from collections.abc import Callable

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


def current_user_context(authorization: str | None, resolve_user_id: UserIdResolver) -> UserContext:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="請先登入雲端帳號。")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="請先登入雲端帳號。")
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


def required_user_context(
    authorization: str | None,
    resolve_authorization: AuthorizationResolver,
) -> UserContext:
    """Reject requests that carry no valid Supabase session.

    Every endpoint that touches school data goes through here so that the
    profile is scoped to the verified cloud user.
    """
    context = resolve_authorization(authorization)
    if context is None:
        raise HTTPException(status_code=401, detail="請先登入雲端帳號後再使用校務同步功能。")
    return context


def official_client_key(context: UserContext, username: str) -> str:
    """Scope cached official-selection clients to the cloud user, not the student ID."""
    return f"{context[0]}:{username.strip()}"


def require_official_action_confirmation(confirmed: bool) -> None:
    if not confirmed:
        raise HTTPException(status_code=400, detail="官方選課操作需要使用者明確確認後才能送出。")
