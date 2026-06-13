from __future__ import annotations

from collections.abc import Callable
from typing import Any
from urllib.parse import quote

import requests

GetRequest = Callable[..., requests.Response]
PostRequest = Callable[..., requests.Response]


def snapshot_url(supabase_url: str, table: str) -> str:
    return f"{supabase_url}/rest/v1/{table}"


def snapshot_query_url(supabase_url: str, table: str, profile_key: str) -> str:
    return (
        f"{snapshot_url(supabase_url, table)}"
        f"?profile_key=eq.{quote(profile_key, safe='')}&select=payload"
    )


def persist_snapshot_row(
    table: str,
    timestamp_field: str,
    profile_key: str,
    school_account: str,
    payload: dict[str, Any],
    *,
    supabase_url: str,
    headers: dict[str, str],
    timeout: int,
    post: PostRequest,
) -> bool:
    body = {
        "profile_key": profile_key,
        "school_account": school_account,
        "payload": payload,
        timestamp_field: payload[timestamp_field],
    }
    if "student_name" in payload:
        body["student_name"] = payload.get("student_name")

    response = post(snapshot_url(supabase_url, table), headers=headers, json=body, timeout=timeout)
    if response.status_code >= 300:
        raise RuntimeError(f"Supabase 寫入 {table} 失敗：{response.status_code} {response.text}")
    return True


def load_snapshot_row(
    table: str,
    profile_key: str,
    *,
    supabase_url: str,
    headers: dict[str, str],
    timeout: int,
    get: GetRequest,
) -> dict[str, Any] | None:
    response = get(snapshot_query_url(supabase_url, table, profile_key), headers=headers, timeout=timeout)
    if response.status_code >= 300:
        raise RuntimeError(f"Supabase 讀取 {table} 失敗：{response.status_code} {response.text}")
    rows = response.json()
    if not rows:
        return None
    payload = rows[0].get("payload")
    return payload if isinstance(payload, dict) else None
