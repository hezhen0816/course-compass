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


def load_school_session_row(
    user_id: str,
    username: str,
    *,
    supabase_url: str,
    timeout: int,
    service_role_headers: HeadersFactory,
    post: PostRequest,
) -> dict[str, Any] | None:
    response = post_rpc(
        "get_school_session",
        {"p_user_id": user_id, "p_school_account": username.strip()},
        supabase_url=supabase_url,
        timeout=timeout,
        service_role_headers=service_role_headers,
        post=post,
    )
    rows = response.json()
    if not rows:
        return None
    row = rows[0] if isinstance(rows, list) else rows
    return row if isinstance(row, dict) else None


def save_school_session_row(
    user_id: str,
    username: str,
    session_ciphertext: str,
    *,
    expires_at: str,
    last_keep_alive_at: str,
    supabase_url: str,
    timeout: int,
    service_role_headers: HeadersFactory,
    post: PostRequest,
) -> None:
    post_rpc(
        "upsert_school_session",
        {
            "p_user_id": user_id,
            "p_school_account": username.strip(),
            "p_session_ciphertext": session_ciphertext,
            "p_expires_at": expires_at,
            "p_last_keep_alive_at": last_keep_alive_at,
        },
        supabase_url=supabase_url,
        timeout=timeout,
        service_role_headers=service_role_headers,
        post=post,
    )


def delete_school_session_row(
    user_id: str,
    username: str | None,
    *,
    supabase_url: str,
    timeout: int,
    service_role_headers: HeadersFactory,
    post: PostRequest,
) -> None:
    post_rpc(
        "delete_school_session",
        {"p_user_id": user_id, "p_school_account": username.strip() if username else None},
        supabase_url=supabase_url,
        timeout=timeout,
        service_role_headers=service_role_headers,
        post=post,
    )
