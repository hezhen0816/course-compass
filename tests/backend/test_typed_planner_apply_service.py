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
    assert "batches" not in report
    assert "rows" not in report["batch_report"]


def test_typed_planner_apply_service_exports_stable_public_api() -> None:
    assert typed_planner_apply.__all__ == [
        "DRY_RUN_MODE",
        "dry_run_typed_planner_backfill_package",
    ]
