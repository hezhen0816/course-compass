from __future__ import annotations

from collections.abc import Callable
from typing import Any
from urllib.parse import quote, urlencode

import requests

GetRequest = Callable[..., requests.Response]
PostRequest = Callable[..., requests.Response]


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def typed_table_url(supabase_url: str, batch_path: str) -> str:
    return f"{supabase_url}{batch_path}"


def typed_select_url(supabase_url: str, table_name: str, params: dict[str, str]) -> str:
    query = urlencode(params, safe="(),.*")
    return f"{supabase_url}/rest/v1/{table_name}?{query}"


def _in_filter(values: list[str]) -> str:
    encoded = ",".join(quote(value, safe="-_.") for value in values)
    return f"in.({encoded})"


def _get_rows(
    table_name: str,
    *,
    supabase_url: str,
    headers: dict[str, str],
    timeout: int,
    get: GetRequest,
    params: dict[str, str],
) -> list[dict[str, Any]]:
    response = get(typed_select_url(supabase_url, table_name, params), headers=headers, timeout=timeout)
    response.raise_for_status()
    rows = response.json()
    return rows if isinstance(rows, list) else []


def _load_by_ids(
    table_name: str,
    column: str,
    ids: list[str],
    *,
    supabase_url: str,
    headers: dict[str, str],
    timeout: int,
    get: GetRequest,
    order: str = "created_at.asc",
) -> list[dict[str, Any]]:
    if not ids:
        return []
    return _get_rows(
        table_name,
        supabase_url=supabase_url,
        headers=headers,
        timeout=timeout,
        get=get,
        params={
            "select": "*",
            column: _in_filter(ids),
            "order": order,
        },
    )


def load_typed_planner_rows(
    user_id: str,
    *,
    supabase_url: str,
    headers: dict[str, str],
    timeout: int,
    get: GetRequest,
) -> dict[str, list[dict[str, Any]]]:
    profiles = _get_rows(
        "planner_profiles",
        supabase_url=supabase_url,
        headers=headers,
        timeout=timeout,
        get=get,
        params={
            "select": "*",
            "user_id": f"eq.{user_id}",
            "profile_key": "eq.default",
            "limit": "1",
        },
    )
    if not profiles:
        return {"planner_profiles": []}

    profile_id = str(profiles[0].get("id") or "")
    terms = _load_by_ids(
        "academic_terms",
        "profile_id",
        [profile_id],
        supabase_url=supabase_url,
        headers=headers,
        timeout=timeout,
        get=get,
        order="term_code.asc",
    )
    term_ids = [str(row.get("id")) for row in terms if row.get("id")]
    courses = _load_by_ids(
        "planner_courses",
        "term_id",
        term_ids,
        supabase_url=supabase_url,
        headers=headers,
        timeout=timeout,
        get=get,
    )
    course_ids = [str(row.get("id")) for row in courses if row.get("id")]

    requirement_sets = _load_by_ids(
        "requirement_sets",
        "profile_id",
        [profile_id],
        supabase_url=supabase_url,
        headers=headers,
        timeout=timeout,
        get=get,
    )
    requirement_set_ids = [str(row.get("id")) for row in requirement_sets if row.get("id")]
    requirements = _load_by_ids(
        "requirements",
        "requirement_set_id",
        requirement_set_ids,
        supabase_url=supabase_url,
        headers=headers,
        timeout=timeout,
        get=get,
    )
    requirement_ids = [str(row.get("id")) for row in requirements if row.get("id")]
    requirement_options = _load_by_ids(
        "requirement_options",
        "requirement_id",
        requirement_ids,
        supabase_url=supabase_url,
        headers=headers,
        timeout=timeout,
        get=get,
    )
    requirement_option_ids = [str(row.get("id")) for row in requirement_options if row.get("id")]

    selection_plans = _load_by_ids(
        "selection_plans",
        "profile_id",
        [profile_id],
        supabase_url=supabase_url,
        headers=headers,
        timeout=timeout,
        get=get,
    )
    selection_plan_ids = [str(row.get("id")) for row in selection_plans if row.get("id")]

    return {
        "planner_profiles": profiles,
        "academic_terms": terms,
        "planner_courses": courses,
        "course_meetings": _load_by_ids(
            "course_meetings",
            "course_id",
            course_ids,
            supabase_url=supabase_url,
            headers=headers,
            timeout=timeout,
            get=get,
        ),
        "course_details": _load_by_ids(
            "course_details",
            "course_id",
            course_ids,
            supabase_url=supabase_url,
            headers=headers,
            timeout=timeout,
            get=get,
        ),
        "grading_items": _load_by_ids(
            "grading_items",
            "course_id",
            course_ids,
            supabase_url=supabase_url,
            headers=headers,
            timeout=timeout,
            get=get,
        ),
        "requirement_sets": requirement_sets,
        "requirements": requirements,
        "requirement_options": requirement_options,
        "requirement_option_courses": _load_by_ids(
            "requirement_option_courses",
            "requirement_option_id",
            requirement_option_ids,
            supabase_url=supabase_url,
            headers=headers,
            timeout=timeout,
            get=get,
        ),
        "academic_history_records": _load_by_ids(
            "academic_history_records",
            "profile_id",
            [profile_id],
            supabase_url=supabase_url,
            headers=headers,
            timeout=timeout,
            get=get,
            order="term_code.asc",
        ),
        "selection_plans": selection_plans,
        "selection_candidates": _load_by_ids(
            "selection_candidates",
            "selection_plan_id",
            selection_plan_ids,
            supabase_url=supabase_url,
            headers=headers,
            timeout=timeout,
            get=get,
        ),
        "selection_priorities": _load_by_ids(
            "selection_priorities",
            "selection_plan_id",
            selection_plan_ids,
            supabase_url=supabase_url,
            headers=headers,
            timeout=timeout,
            get=get,
            order="priority.asc",
        ),
        "official_selection_cache": _load_by_ids(
            "official_selection_cache",
            "profile_id",
            [profile_id],
            supabase_url=supabase_url,
            headers=headers,
            timeout=timeout,
            get=get,
        ),
    }


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
