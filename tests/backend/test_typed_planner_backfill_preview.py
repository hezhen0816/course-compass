from __future__ import annotations

import json
from pathlib import Path

from backend.services import typed_planner_backfill
from backend.services.typed_planner_backfill import (
    CONTRACT_VERSION,
    build_typed_planner_preview,
    build_typed_planner_reconciliation,
    write_typed_planner_backfill_package,
)


def _sample_content() -> dict[str, object]:
    return {
        "schemaVersion": 3,
        "settings": {
            "school_account": "B11430207",
            "gpaApi": {"enabled": True, "apiKey": "secret-token"},
            "customSetting": "keep-me",
        },
        "semesters": [
            {
                "id": "1151",
                "name": "1151 · 2026 Fall",
                "courses": [
                    {
                        "id": "course-1",
                        "name": "資料結構",
                        "credits": 3,
                        "category": "compulsory",
                        "customCourseField": "preserve",
                        "scheduledOffering": {
                            "courseNo": "CS2002302",
                            "courseName": "資料結構",
                            "teacher": "陳冠宇",
                            "classroom": "TR-313",
                            "slots": ["M3", "M4"],
                            "requireOption": "必修",
                        },
                        "details": {
                            "professor": "陳冠宇",
                            "gradingPolicy": [
                                {"id": "midterm", "name": "期中", "weight": 40, "score": 88},
                            ],
                        },
                    }
                ],
            }
        ],
        "requirementSets": [
            {"id": "set-1", "name": "雙主修", "department": "BA", "source": "manual"},
        ],
        "pendingRequirements": [
            {
                "id": "req-1",
                "setId": "set-1",
                "kind": "choice",
                "title": "管理課程",
                "requiredCredits": 3,
                "options": [
                    {"name": "擇一", "credits": 3, "courseNames": ["管理會計", "成本會計"]},
                ],
            }
        ],
        "historyRecords": [
            {
                "category": "系必修",
                "courseCode": "CS1001301",
                "courseName": "計算機概論",
                "academicTerm": "1141",
                "grade": "A",
                "credits": 3,
                "status": "passed",
            }
        ],
        "selectionPlan": {
            "targetAcademicTerm": "1151",
            "courses": [
                {
                    "id": "sel-1",
                    "name": "成本會計",
                    "credits": 3,
                    "scheduledOffering": {"courseNo": "BA2505701", "teacher": "張鳳真"},
                },
                {
                    "id": "sel-2",
                    "name": "待加簽課",
                    "credits": 1,
                    "virtualSelection": {"status": "manual", "reason": "待加簽"},
                },
            ],
            "officialSelectionCache": {
                "school_account": "B11430207",
                "synced_at": "2026-06-15T12:00:00Z",
                "registered_courses": [
                    {
                        "priority": 1,
                        "course_no": "FE1151705",
                        "course_name": "文法與修辭",
                        "credits": 2,
                        "require_option": "選修",
                        "teacher": "陳茗宜",
                        "gpa": 3.48,
                        "gpa_status": "found",
                    }
                ],
                "available_courses": [
                    {"course_no": "BA4010701", "course_name": "進入職場實務演練", "teacher": "吳雪麗"},
                ],
                "required_preset_courses": [
                    {"course_no": "CS2022301", "course_name": "數位系統設計", "credits": 3},
                ],
            },
        },
    }


def test_typed_planner_backfill_preview_counts_core_rows() -> None:
    preview = build_typed_planner_preview(
        [{"user_id": "11111111-1111-1111-1111-111111111111", "content": _sample_content()}]
    )

    assert preview["contract_version"] == CONTRACT_VERSION
    assert preview["mode"] == "preview_only_no_database_writes"
    assert preview["warnings"] == []
    assert preview["source_counts"] == {
        "input_rows": 1,
        "valid_user_rows": 1,
        "semesters": 1,
        "semester_courses": 1,
        "requirement_sets": 1,
        "pending_requirements": 1,
        "history_records": 1,
        "selection_courses": 2,
        "official_registered_courses": 1,
        "official_available_courses": 1,
        "official_required_preset_courses": 1,
    }
    assert preview["counts"]["planner_profiles"] == 1
    assert preview["counts"]["academic_terms"] == 1
    assert preview["counts"]["planner_courses"] == 1
    assert preview["counts"]["course_meetings"] == 2
    assert preview["counts"]["course_details"] == 1
    assert preview["counts"]["grading_items"] == 1
    assert preview["counts"]["requirement_sets"] == 1
    assert preview["counts"]["requirements"] == 1
    assert preview["counts"]["requirement_options"] == 1
    assert preview["counts"]["requirement_option_courses"] == 2
    assert preview["counts"]["academic_history_records"] == 1
    assert preview["counts"]["selection_plans"] == 1
    assert preview["counts"]["selection_candidates"] == 5
    assert preview["counts"]["selection_priorities"] == 2
    assert preview["counts"]["official_selection_cache"] == 1

    course = preview["tables"]["planner_courses"][0]
    assert course["course_no"] == "CS2002302"
    assert course["department_code"] == "CS"
    assert course["requirement_category"] == "compulsory"

    first_meeting = preview["tables"]["course_meetings"][0]
    assert first_meeting["weekday"] == 1
    assert first_meeting["period"] == "3"
    assert first_meeting["room"] == "TR-313"

    official_candidate = next(
        row for row in preview["tables"]["selection_candidates"] if row["course_no"] == "FE1151705"
    )
    assert official_candidate["gpa"] == 3.48
    assert official_candidate["gpa_status"] == "found"


def test_typed_planner_backfill_preview_preserves_unknowns_but_redacts_secrets() -> None:
    preview = build_typed_planner_preview(
        [{"user_id": "11111111-1111-1111-1111-111111111111", "content": _sample_content()}]
    )

    profile = preview["tables"]["planner_profiles"][0]
    assert profile["settings"]["customSetting"] == "keep-me"
    assert profile["settings"]["gpaApi"]["apiKey"] == "[redacted]"

    course = preview["tables"]["planner_courses"][0]
    source_payload = course["metadata"]["source_payload"]
    assert source_payload["customCourseField"] == "preserve"

    profile_source = profile["metadata"]["source_payload"]
    assert profile_source["settings"]["gpaApi"]["apiKey"] == "[redacted]"


def test_typed_planner_reconciliation_reports_mismatch_when_source_cannot_map() -> None:
    preview = build_typed_planner_preview(
        [
            {
                "user_id": "11111111-1111-1111-1111-111111111111",
                "content": {
                    "pendingRequirements": [
                        {
                            "id": "req-without-set",
                            "setId": "missing-set",
                            "kind": "choice",
                            "title": "缺少需求集",
                        }
                    ]
                },
            }
        ],
        include_rows=False,
    )

    reconciliation = build_typed_planner_reconciliation(preview)

    assert reconciliation["contract_version"] == CONTRACT_VERSION
    assert reconciliation["status"] == "failed"
    failed_check = next(
        check for check in reconciliation["checks"] if check["name"] == "pending_requirements_to_requirements"
    )
    assert failed_check == {
        "name": "pending_requirements_to_requirements",
        "source_count": 1,
        "target_count": 0,
        "status": "mismatch",
    }
    assert reconciliation["warnings"] == ["pendingRequirements[0] skipped: missing requirement set 'missing-set'"]


def test_typed_planner_package_writes_backup_preview_reconciliation_and_manifest(tmp_path: Path) -> None:
    rows = [{"user_id": "11111111-1111-1111-1111-111111111111", "content": _sample_content()}]

    manifest = write_typed_planner_backfill_package(
        rows,
        tmp_path,
        include_rows=True,
        force=False,
    )

    assert manifest["mode"] == "typed_planner_backfill_package"
    assert manifest["contract_version"] == CONTRACT_VERSION
    assert manifest["status"] == "passed"
    assert manifest["database_writes"] is False
    assert manifest["contains_sensitive_backup"] is True
    assert set(manifest["files"]) == {"backup", "preview", "reconciliation", "manifest"}

    backup = json.loads((tmp_path / "backup-user-data.json").read_text(encoding="utf-8"))
    preview = json.loads((tmp_path / "preview.json").read_text(encoding="utf-8"))
    reconciliation = json.loads((tmp_path / "reconciliation.json").read_text(encoding="utf-8"))
    written_manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))

    assert backup["mode"] == "raw_user_data_backup"
    assert backup["contract_version"] == CONTRACT_VERSION
    assert backup["contains_sensitive_source_data"] is True
    assert backup["rows"][0]["content"]["settings"]["gpaApi"]["apiKey"] == "secret-token"
    assert preview["tables"]["planner_profiles"][0]["settings"]["gpaApi"]["apiKey"] == "[redacted]"
    assert preview["contract_version"] == CONTRACT_VERSION
    assert reconciliation["status"] == "passed"
    assert reconciliation["contract_version"] == CONTRACT_VERSION
    assert written_manifest["status"] == "passed"


def test_typed_planner_backfill_service_exports_stable_public_api() -> None:
    assert typed_planner_backfill.__all__ == [
        "CONTRACT_VERSION",
        "PACKAGE_FILES",
        "TABLE_NAMES",
        "build_typed_planner_backfill_package",
        "build_typed_planner_preview",
        "build_typed_planner_reconciliation",
        "load_user_data_rows",
        "write_typed_planner_backfill_package",
    ]
