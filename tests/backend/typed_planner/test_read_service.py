from __future__ import annotations

from backend.services.typed_planner.backfill import build_typed_planner_preview
from backend.services.typed_planner.read import build_app_data_from_typed_rows


def _sample_rows() -> dict[str, list[dict[str, object]]]:
    preview = build_typed_planner_preview(
        [
            {
                "user_id": "11111111-1111-1111-1111-111111111111",
                "content": {
                    "schemaVersion": 2,
                    "targets": {"total": 128},
                    "settings": {"school_account": "B11430207", "customSetting": "keep-me"},
                    "semesters": [
                        {
                            "id": "1141",
                            "name": "大一上",
                            "courses": [
                                {
                                    "id": "course-1",
                                    "name": "計算機概論",
                                    "credits": 3,
                                    "category": "compulsory",
                                    "scheduledOffering": {
                                        "courseNo": "CS1001301",
                                        "courseName": "計算機概論",
                                        "teacher": "林老師",
                                        "classroom": "TR-101",
                                        "slots": ["M3", "M4"],
                                        "requireOption": "必修",
                                    },
                                    "details": {
                                        "professor": "林老師",
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
                                {"name": "擇一", "credits": 3, "courseNames": ["管理會計"]},
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
                        "targetLabel": "1151 · 2026 Fall",
                        "courses": [
                            {
                                "id": "sel-1",
                                "name": "管理會計",
                                "credits": 3,
                                "scheduledOffering": {"courseNo": "BA2505701", "teacher": "張老師"},
                            },
                        ],
                        "officialSelectionCache": {
                            "school_account": "B11430207",
                            "synced_at": "2026-06-15T12:00:00Z",
                            "registered_courses": [],
                            "available_courses": [],
                            "required_preset_courses": [],
                        },
                    },
                },
            }
        ]
    )
    return preview["tables"]


def test_build_app_data_from_typed_rows_restores_frontend_shape() -> None:
    app_data = build_app_data_from_typed_rows(_sample_rows())

    assert app_data["schemaVersion"] == 3
    assert app_data["targets"] == {"total": 128}
    assert app_data["settings"]["school_account"] == "B11430207"
    assert app_data["settings"]["customSetting"] == "keep-me"

    assert app_data["semesters"][0]["id"] == "1141"
    assert app_data["semesters"][0]["courses"][0]["id"] == "course-1"
    assert app_data["semesters"][0]["courses"][0]["scheduledOffering"]["courseNo"] == "CS1001301"
    assert app_data["semesters"][0]["courses"][0]["details"]["gradingPolicy"][0]["score"] == 88

    assert app_data["requirementSets"][0]["id"] == "set-1"
    assert app_data["pendingRequirements"][0]["setId"] == "set-1"
    assert app_data["pendingRequirements"][0]["options"][0]["courseNames"] == ["管理會計"]

    assert app_data["historyRecords"][0]["courseCode"] == "CS1001301"
    assert app_data["selectionPlan"]["targetAcademicTerm"] == "1151"
    assert app_data["selectionPlan"]["courses"][0]["id"] == "sel-1"
    assert app_data["selectionPlan"]["officialSelectionCache"]["school_account"] == "B11430207"


def test_build_app_data_from_typed_rows_returns_empty_shape_without_profile() -> None:
    assert build_app_data_from_typed_rows({"planner_profiles": []}) == {
        "schemaVersion": 3,
        "settings": {},
        "semesters": [],
        "requirementSets": [],
        "pendingRequirements": [],
        "historyRecords": [],
    }
