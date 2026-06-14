from __future__ import annotations

from collections.abc import Callable
from typing import Any
from urllib.parse import quote

import requests

HeadersFactory = Callable[..., dict[str, str]]
GetRequest = Callable[..., requests.Response]
PostRequest = Callable[..., requests.Response]


def rpc_url(supabase_url: str, name: str) -> str:
    return f"{supabase_url}/rest/v1/rpc/{name}"


def auth_user_url(supabase_url: str) -> str:
    return f"{supabase_url}/auth/v1/user"


def user_data_content_url(supabase_url: str, user_id: str) -> str:
    return (
        f"{supabase_url}/rest/v1/user_data"
        f"?user_id=eq.{quote(user_id, safe='')}&select=content"
    )


def user_data_content_list_url(supabase_url: str) -> str:
    return f"{supabase_url}/rest/v1/user_data?select=user_id,content"


def user_data_upsert_url(supabase_url: str) -> str:
    return f"{supabase_url}/rest/v1/user_data?on_conflict=user_id"


def fetch_auth_user(
    access_token: str,
    *,
    supabase_url: str,
    api_key: str,
    timeout: int,
    get: GetRequest,
) -> requests.Response:
    response = get(
        auth_user_url(supabase_url),
        headers={
            "apikey": api_key,
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        },
        timeout=timeout,
    )
    if response.status_code not in {401, 403}:
        response.raise_for_status()
    return response


def load_user_content(
    user_id: str,
    *,
    supabase_url: str,
    headers: dict[str, str],
    timeout: int,
    get: GetRequest,
) -> dict[str, Any]:
    response = get(user_data_content_url(supabase_url, user_id), headers=headers, timeout=timeout)
    response.raise_for_status()
    rows = response.json()
    if not rows:
        return {"schemaVersion": 2, "settings": {}}
    content = rows[0].get("content")
    return content if isinstance(content, dict) else {"schemaVersion": 2, "settings": {}}


def list_user_data_content_rows(
    *,
    supabase_url: str,
    headers: dict[str, str],
    timeout: int,
    get: GetRequest,
) -> list[dict[str, Any]]:
    response = get(user_data_content_list_url(supabase_url), headers=headers, timeout=timeout)
    response.raise_for_status()
    rows = response.json()
    return rows if isinstance(rows, list) else []


def save_user_content(
    user_id: str,
    content: dict[str, Any],
    *,
    supabase_url: str,
    headers: dict[str, str],
    timeout: int,
    updated_at: str,
    post: PostRequest,
    last_writer: str = "backend",
) -> None:
    body = {
        "user_id": user_id,
        "content": content,
        "content_version": 2,
        "last_writer": last_writer,
        "updated_at": updated_at,
    }
    response = post(user_data_upsert_url(supabase_url), headers=headers, json=body, timeout=timeout)
    response.raise_for_status()


def post_rpc(
    name: str,
    payload: dict[str, Any],
    *,
    supabase_url: str,
    timeout: int,
    service_role_headers: HeadersFactory,
    post: PostRequest,
) -> requests.Response:
    response = post(
        rpc_url(supabase_url, name),
        headers=service_role_headers(json_body=True),
        json=payload,
        timeout=timeout,
    )
    response.raise_for_status()
    return response


def load_school_credentials_row(
    user_id: str,
    *,
    supabase_url: str,
    timeout: int,
    service_role_headers: HeadersFactory,
    post: PostRequest,
) -> dict[str, Any] | None:
    response = post_rpc(
        "get_school_credentials",
        {"p_user_id": user_id},
        supabase_url=supabase_url,
        timeout=timeout,
        service_role_headers=service_role_headers,
        post=post,
    )
    rows = response.json()
    if not rows:
        return None
    if isinstance(rows, list):
        return rows[0] if rows else None
    return rows if isinstance(rows, dict) else None


def upsert_school_credentials_row(
    user_id: str,
    username: str,
    password_ciphertext: str,
    *,
    key_version: int,
    last_verified_at: str,
    supabase_url: str,
    timeout: int,
    service_role_headers: HeadersFactory,
    post: PostRequest,
) -> None:
    post_rpc(
        "upsert_school_credentials",
        {
            "p_user_id": user_id,
            "p_school_account": username,
            "p_password_ciphertext": password_ciphertext,
            "p_key_version": key_version,
            "p_last_verified_at": last_verified_at,
        },
        supabase_url=supabase_url,
        timeout=timeout,
        service_role_headers=service_role_headers,
        post=post,
    )


def delete_school_credentials_row(
    user_id: str,
    *,
    supabase_url: str,
    timeout: int,
    service_role_headers: HeadersFactory,
    post: PostRequest,
) -> None:
    post_rpc(
        "delete_school_credentials",
        {"p_user_id": user_id},
        supabase_url=supabase_url,
        timeout=timeout,
        service_role_headers=service_role_headers,
        post=post,
    )
