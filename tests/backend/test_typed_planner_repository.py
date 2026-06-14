from __future__ import annotations

import pytest

from backend.repositories import typed_planner as typed_planner_repository
from backend.services.typed_planner_backfill import build_typed_planner_apply_batches, build_typed_planner_backfill_package


def _batches_payload() -> dict[str, object]:
    package = build_typed_planner_backfill_package(
        [
            {
                "user_id": "11111111-1111-1111-1111-111111111111",
                "content": {
                    "settings": {"school_account": "B11430207"},
                    "semesters": [],
                },
            }
        ]
    )
    return build_typed_planner_apply_batches(package)


def test_typed_planner_repository_dry_run_summarizes_without_posting() -> None:
    calls: list[object] = []

    def fake_post(**_kwargs: object) -> object:
        calls.append(_kwargs)
        raise AssertionError("dry-run must not post")

    report = typed_planner_repository.execute_apply_batches(
        _batches_payload(),
        supabase_url="https://example.supabase.co",
        headers={"Authorization": "Bearer service"},
        timeout=12,
        post=fake_post,
        dry_run=True,
    )

    assert calls == []
    assert report == {
        "mode": "typed_planner_apply_batches_repository",
        "database_writes": False,
        "dry_run": True,
        "status": "ready",
        "batch_count": 18,
        "non_empty_batch_count": 1,
        "skipped_empty_batch_count": 17,
        "total_row_count": 1,
        "tables": [
            "planner_profiles",
            "academic_terms",
            "planner_courses",
            "course_meetings",
            "course_details",
            "grading_items",
            "requirement_sets",
            "requirements",
            "requirement_options",
            "requirement_option_courses",
            "academic_history_records",
            "selection_plans",
            "selection_candidates",
            "selection_priorities",
            "official_selection_cache",
            "course_offerings",
            "course_offering_meetings",
            "sync_runs",
        ],
    }


def test_typed_planner_repository_posts_batches_in_order() -> None:
    calls: list[tuple[str, dict[str, str], list[dict[str, object]], int]] = []

    class Response:
        status_code = 201
        text = "created"

    def fake_post(url: str, headers: dict[str, str], json: list[dict[str, object]], timeout: int) -> Response:
        calls.append((url, headers, json, timeout))
        return Response()

    report = typed_planner_repository.execute_apply_batches(
        _batches_payload(),
        supabase_url="https://example.supabase.co",
        headers={"Authorization": "Bearer service", "Content-Type": "application/json"},
        timeout=12,
        post=fake_post,
        dry_run=False,
    )

    assert report["database_writes"] is True
    assert report["status"] == "applied"
    assert report["non_empty_batch_count"] == 1
    assert report["skipped_empty_batch_count"] == 17
    assert len(calls) == 1
    assert calls[0][0] == "https://example.supabase.co/rest/v1/planner_profiles?on_conflict=id"
    assert calls[0][1] == {
        "Authorization": "Bearer service",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    assert calls[0][2][0]["school_account"] == "B11430207"
    assert calls[0][3] == 12


def test_typed_planner_repository_raises_on_failed_batch() -> None:
    class Response:
        status_code = 500
        text = "boom"

    def fake_post(*_args: object, **_kwargs: object) -> Response:
        return Response()

    with pytest.raises(RuntimeError, match="planner_profiles failed: 500 boom"):
        typed_planner_repository.execute_apply_batches(
            _batches_payload(),
            supabase_url="https://example.supabase.co",
            headers={"Authorization": "Bearer service"},
            timeout=12,
            post=fake_post,
            dry_run=False,
        )
