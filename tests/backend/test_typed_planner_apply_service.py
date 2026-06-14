from __future__ import annotations

from pathlib import Path

from backend.services import typed_planner_apply
from backend.services.typed_planner_backfill import write_typed_planner_backfill_package


def _write_sample_package(package_dir: Path) -> None:
    write_typed_planner_backfill_package(
        [
            {
                "user_id": "11111111-1111-1111-1111-111111111111",
                "content": {
                    "settings": {"school_account": "B11430207"},
                    "semesters": [],
                },
            }
        ],
        package_dir,
    )


def test_typed_planner_apply_dry_run_summarizes_package_without_rows(tmp_path: Path) -> None:
    _write_sample_package(tmp_path)

    report = typed_planner_apply.dry_run_typed_planner_backfill_package(tmp_path)

    assert report["mode"] == typed_planner_apply.DRY_RUN_MODE
    assert report["database_writes"] is False
    assert report["status"] == "ready"
    assert report["package_status"] == "passed"
    assert report["batch_artifact_mode"] == "typed_planner_postgrest_upsert_batches_no_database_writes"
    assert report["batch_report"] == {
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
    assert report["readiness"] == {
        "mode": typed_planner_apply.READINESS_MODE,
        "status": "ready",
        "checks": [
            {
                "name": "package_reconciliation_passed",
                "status": "passed",
                "detail": "manifest.status must be passed",
            },
            {
                "name": "package_is_no_write",
                "status": "passed",
                "detail": "manifest.database_writes must be false",
            },
            {
                "name": "raw_backup_matches_input",
                "status": "passed",
                "detail": "raw backup must exist and match manifest input row count",
            },
            {
                "name": "preview_tables_present",
                "status": "passed",
                "detail": "preview must include table rows; rebuild package without --counts-only",
            },
            {
                "name": "batches_are_no_write",
                "status": "passed",
                "detail": "batch artifact must be no-write",
            },
            {
                "name": "repository_dry_run_is_no_write",
                "status": "passed",
                "detail": "repository dry-run must not write",
            },
            {
                "name": "non_empty_batches_present",
                "status": "passed",
                "detail": "at least one non-empty typed table batch must be present",
            },
        ],
    }
    assert "batches" not in report
    assert "rows" not in report["batch_report"]


def test_typed_planner_apply_readiness_blocks_empty_package(tmp_path: Path) -> None:
    write_typed_planner_backfill_package([], tmp_path)

    report = typed_planner_apply.dry_run_typed_planner_backfill_package(tmp_path)

    assert report["status"] == "blocked"
    assert report["readiness"]["status"] == "blocked"
    failed_checks = [check["name"] for check in report["readiness"]["checks"] if check["status"] == "failed"]
    assert failed_checks == ["non_empty_batches_present"]


def test_typed_planner_execute_requires_confirmation_before_posting(tmp_path: Path) -> None:
    _write_sample_package(tmp_path)
    calls: list[object] = []

    def fake_post(*_args: object, **_kwargs: object) -> object:
        calls.append((_args, _kwargs))
        raise AssertionError("unconfirmed apply must not post")

    try:
        typed_planner_apply.execute_typed_planner_backfill_package(
            tmp_path,
            supabase_url="https://example.supabase.co",
            headers={"Authorization": "Bearer service"},
            timeout=12,
            post=fake_post,
            allow_writes=False,
            confirmation=typed_planner_apply.EXECUTE_CONFIRMATION,
        )
    except ValueError as exc:
        assert str(exc) == "typed planner apply requires allow_writes=True and exact confirmation"
    else:
        raise AssertionError("execute should reject missing allow_writes")

    assert calls == []

    try:
        typed_planner_apply.execute_typed_planner_backfill_package(
            tmp_path,
            supabase_url="https://example.supabase.co",
            headers={"Authorization": "Bearer service"},
            timeout=12,
            post=fake_post,
            allow_writes=True,
            confirmation="WRONG",
        )
    except ValueError as exc:
        assert str(exc) == "typed planner apply requires allow_writes=True and exact confirmation"
    else:
        raise AssertionError("execute should reject wrong confirmation")

    assert calls == []


def test_typed_planner_execute_rejects_blocked_readiness_before_posting(tmp_path: Path) -> None:
    write_typed_planner_backfill_package([], tmp_path)
    calls: list[object] = []

    def fake_post(*_args: object, **_kwargs: object) -> object:
        calls.append((_args, _kwargs))
        raise AssertionError("blocked readiness must not post")

    try:
        typed_planner_apply.execute_typed_planner_backfill_package(
            tmp_path,
            supabase_url="https://example.supabase.co",
            headers={"Authorization": "Bearer service"},
            timeout=12,
            post=fake_post,
            allow_writes=True,
            confirmation=typed_planner_apply.EXECUTE_CONFIRMATION,
        )
    except ValueError as exc:
        assert str(exc) == "typed planner apply requires ready dry-run readiness"
    else:
        raise AssertionError("execute should reject blocked readiness")

    assert calls == []


def test_typed_planner_execute_posts_only_after_confirmation_and_ready_dry_run(tmp_path: Path) -> None:
    _write_sample_package(tmp_path)
    calls: list[tuple[str, dict[str, str], list[dict[str, object]], int]] = []

    class Response:
        status_code = 201
        text = "created"

    def fake_post(url: str, headers: dict[str, str], json: list[dict[str, object]], timeout: int) -> Response:
        calls.append((url, headers, json, timeout))
        return Response()

    report = typed_planner_apply.execute_typed_planner_backfill_package(
        tmp_path,
        supabase_url="https://example.supabase.co",
        headers={"Authorization": "Bearer service"},
        timeout=12,
        post=fake_post,
        allow_writes=True,
        confirmation=typed_planner_apply.EXECUTE_CONFIRMATION,
    )

    assert report["mode"] == typed_planner_apply.EXECUTE_MODE
    assert report["database_writes"] is True
    assert report["status"] == "applied"
    assert report["readiness"]["status"] == "ready"
    assert report["batch_report"]["database_writes"] is True
    assert len(calls) == 1
    assert calls[0][0] == "https://example.supabase.co/rest/v1/planner_profiles?on_conflict=id"
    assert calls[0][2][0]["school_account"] == "B11430207"


def test_typed_planner_apply_service_exports_stable_public_api() -> None:
    assert typed_planner_apply.__all__ == [
        "DRY_RUN_MODE",
        "EXECUTE_CONFIRMATION",
        "EXECUTE_MODE",
        "READINESS_MODE",
        "dry_run_typed_planner_backfill_package",
        "execute_typed_planner_backfill_package",
    ]
