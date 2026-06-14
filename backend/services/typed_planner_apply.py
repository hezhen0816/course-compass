from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.repositories import typed_planner as typed_planner_repository
from backend.services.typed_planner_backfill import build_typed_planner_apply_batches, load_typed_planner_backfill_package


DRY_RUN_MODE = "typed_planner_backfill_apply_dry_run"

__all__ = [
    "DRY_RUN_MODE",
    "dry_run_typed_planner_backfill_package",
]


def _blocked_post(*_args: object, **_kwargs: object) -> object:
    raise RuntimeError("typed planner apply dry-run must not post")


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
    return {
        "mode": DRY_RUN_MODE,
        "contract_version": batches["contract_version"],
        "database_writes": False,
        "status": repository_report["status"],
        "package_status": manifest.get("status"),
        "batch_artifact_mode": batches["mode"],
        "batch_report": repository_report,
    }
