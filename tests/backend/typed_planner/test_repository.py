from __future__ import annotations

import pytest

from backend.repositories import typed_planner as typed_planner_repository
from backend.services.typed_planner.backfill import build_typed_planner_apply_batches, build_typed_planner_backfill_package


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


def test_typed_planner_repository_loads_related_rows_in_order() -> None:
    calls: list[str] = []
    payloads = {
        "planner_profiles": [{"id": "profile-1"}],
        "academic_terms": [{"id": "term-1"}],
        "planner_courses": [{"id": "course-1"}],
        "requirement_sets": [{"id": "set-1"}],
        "requirements": [{"id": "req-1"}],
        "requirement_options": [{"id": "option-1"}],
        "selection_plans": [{"id": "plan-1"}],
    }

    class Response:
        def __init__(self, rows: list[dict[str, object]]) -> None:
            self.rows = rows

        def raise_for_status(self) -> None:
            return None

        def json(self) -> list[dict[str, object]]:
            return self.rows

    def fake_get(url: str, headers: dict[str, str], timeout: int) -> Response:
        calls.append(url)
        for table, rows in payloads.items():
            if f"/rest/v1/{table}?" in url:
                return Response(rows)
        return Response([])

    rows = typed_planner_repository.load_typed_planner_rows(
        "11111111-1111-1111-1111-111111111111",
        supabase_url="https://example.supabase.co",
        headers={"Authorization": "Bearer service"},
        timeout=12,
        get=fake_get,
    )

    assert rows["planner_profiles"] == [{"id": "profile-1"}]
    assert rows["academic_terms"] == [{"id": "term-1"}]
    assert rows["planner_courses"] == [{"id": "course-1"}]
    assert rows["selection_plans"] == [{"id": "plan-1"}]
    assert calls[0] == (
        "https://example.supabase.co/rest/v1/planner_profiles?"
        "select=*&user_id=eq.11111111-1111-1111-1111-111111111111&profile_key=eq.default&limit=1"
    )
    assert any("/rest/v1/course_meetings?select=*&course_id=in.(course-1)" in call for call in calls)
