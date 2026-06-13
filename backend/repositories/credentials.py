from __future__ import annotations

from collections.abc import Callable
from typing import Any

import requests

HeadersFactory = Callable[..., dict[str, str]]
PostRequest = Callable[..., requests.Response]


def rpc_url(supabase_url: str, name: str) -> str:
    return f"{supabase_url}/rest/v1/rpc/{name}"


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
