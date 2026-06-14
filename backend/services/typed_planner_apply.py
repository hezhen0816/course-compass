from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.repositories import typed_planner as typed_planner_repository
from backend.services.typed_planner_backfill import build_typed_planner_apply_batches, load_typed_planner_backfill_package


DRY_RUN_MODE = "typed_planner_backfill_apply_dry_run"
READINESS_MODE = "typed_planner_backfill_apply_readiness"

__all__ = [
    "DRY_RUN_MODE",
    "READINESS_MODE",
    "dry_run_typed_planner_backfill_package",
]


def _blocked_post(*_args: object, **_kwargs: object) -> object:
    raise RuntimeError("typed planner apply dry-run must not post")


def _check(name: str, passed: bool, detail: str) -> dict[str, Any]:
    return {
        "name": name,
        "status": "passed" if passed else "failed",
        "detail": detail,
    }


def _readiness_report(
    *,
    package: dict[str, Any],
    batches: dict[str, Any],
    repository_report: dict[str, Any],
) -> dict[str, Any]:
    manifest = package["manifest"] if isinstance(package.get("manifest"), dict) else {}
    backup = package["backup"] if isinstance(package.get("backup"), dict) else {}
    preview = package["preview"] if isinstance(package.get("preview"), dict) else {}
    checks = [
        _check(
            "package_reconciliation_passed",
            manifest.get("status") == "passed",
            "manifest.status must be passed",
        ),
        _check(
            "package_is_no_write",
            manifest.get("database_writes") is False,
            "manifest.database_writes must be false",
        ),
        _check(
            "raw_backup_matches_input",
            backup.get("mode") == "raw_user_data_backup"
            and backup.get("contains_sensitive_source_data") is True
            and backup.get("row_count") == manifest.get("input_row_count"),
            "raw backup must exist and match manifest input row count",
        ),
        _check(
            "preview_tables_present",
            isinstance(preview.get("tables"), dict),
            "preview must include table rows; rebuild package without --counts-only",
        ),
        _check(
            "batches_are_no_write",
            batches.get("database_writes") is False,
            "batch artifact must be no-write",
        ),
        _check(
            "repository_dry_run_is_no_write",
            repository_report.get("dry_run") is True and repository_report.get("database_writes") is False,
            "repository dry-run must not write",
        ),
        _check(
            "non_empty_batches_present",
            int(repository_report.get("non_empty_batch_count") or 0) > 0,
            "at least one non-empty typed table batch must be present",
        ),
    ]
    return {
        "mode": READINESS_MODE,
        "status": "ready" if all(check["status"] == "passed" for check in checks) else "blocked",
        "checks": checks,
    }


def dry_run_typed_planner_backfill_package(package_dir: Path) -> dict[str, Any]:
    package = load_typed_planner_backfill_package(package_dir)
    batches = build_typed_planner_apply_batches(package)
    repository_report = typed_planner_repository.execute_apply_batches(
        batches,
        supabase_url="",
        headers={},
        timeout=0,
        post=_blocked_post,
        dry_run=True,
    )
    manifest = package["manifest"] if isinstance(package.get("manifest"), dict) else {}
    readiness = _readiness_report(package=package, batches=batches, repository_report=repository_report)
    return {
        "mode": DRY_RUN_MODE,
        "contract_version": batches["contract_version"],
        "database_writes": False,
        "status": readiness["status"],
        "package_status": manifest.get("status"),
        "batch_artifact_mode": batches["mode"],
        "batch_report": repository_report,
        "readiness": readiness,
    }
