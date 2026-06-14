from __future__ import annotations

from scripts.preview_typed_planner_backfill import build_typed_planner_preview


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
