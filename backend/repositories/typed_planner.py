from __future__ import annotations

from collections.abc import Callable
from typing import Any

import requests

PostRequest = Callable[..., requests.Response]


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def typed_table_url(supabase_url: str, batch_path: str) -> str:
    return f"{supabase_url}{batch_path}"


def execute_apply_batches(
    batches_payload: dict[str, Any],
    *,
    supabase_url: str,
    headers: dict[str, str],
    timeout: int,
    post: PostRequest,
    dry_run: bool = True,
) -> dict[str, Any]:
    batches = _as_list(batches_payload.get("batches"))
    report = {
        "mode": "typed_planner_apply_batches_repository",
        "database_writes": not dry_run,
        "dry_run": dry_run,
        "status": "ready" if dry_run else "applied",
        "batch_count": len(batches),
        "non_empty_batch_count": sum(1 for batch in batches if isinstance(batch, dict) and _as_list(batch.get("rows"))),
        "skipped_empty_batch_count": sum(1 for batch in batches if isinstance(batch, dict) and not _as_list(batch.get("rows"))),
        "total_row_count": sum(int(batch.get("row_count") or 0) for batch in batches if isinstance(batch, dict)),
        "tables": [batch.get("table") for batch in batches if isinstance(batch, dict)],
    }
    if dry_run:
        return report

    for batch in batches:
        if not isinstance(batch, dict):
            raise ValueError("typed planner apply batch must be an object")
        rows = _as_list(batch.get("rows"))
        if not rows:
            continue
        batch_headers = dict(headers)
        batch_headers.update(batch.get("headers") if isinstance(batch.get("headers"), dict) else {})
        response = post(
            typed_table_url(supabase_url, str(batch.get("path") or "")),
            headers=batch_headers,
            json=rows,
            timeout=timeout,
        )
        if response.status_code >= 300:
            table = batch.get("table") or "unknown"
            raise RuntimeError(f"Supabase typed planner upsert {table} failed: {response.status_code} {response.text}")
    return report
