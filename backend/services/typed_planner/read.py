from __future__ import annotations

import copy
import re
from collections import defaultdict
from typing import Any

import requests

try:
    from ...core.config import DEFAULT_TIMEOUT, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
    from ...core import security
    from ...repositories import typed_planner as typed_planner_repository
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from core.config import DEFAULT_TIMEOUT, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
    from core import security
    from repositories import typed_planner as typed_planner_repository


COLLECTION_KEYS = {
    "semesters",
    "requirementSets",
    "pendingRequirements",
    "historyRecords",
    "selectionPlan",
}
DAY_CODES = {1: "M", 2: "T", 3: "W", 4: "R", 5: "F", 6: "S", 7: "U"}

__all__ = [
    "build_app_data_from_typed_rows",
    "read_typed_planner_app_data",
]


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _source_payload(row: dict[str, Any]) -> dict[str, Any]:
    return copy.deepcopy(_as_dict(_as_dict(row.get("metadata")).get("source_payload")))


def _source_index(row: dict[str, Any], pattern: str, default: int = 999_999) -> int:
    source_path = str(_as_dict(row.get("metadata")).get("source_path") or "")
    match = re.search(pattern, source_path)
    return int(match.group(1)) if match else default


def _number(value: Any, default: float = 0) -> float:
    if value in (None, ""):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _number_or_none(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _slots_from_meetings(meetings: list[dict[str, Any]]) -> list[str]:
    slots: list[str] = []
    for meeting in sorted(meetings, key=lambda row: (_number(row.get("weekday"), 99), _clean(row.get("period")))):
        raw_time = _clean(meeting.get("raw_time"))
        if raw_time:
            slots.append(raw_time)
            continue
        day_code = DAY_CODES.get(int(_number(meeting.get("weekday"), 0)))
        period = _clean(meeting.get("period"))
        if day_code and period:
            slots.append(f"{day_code}{period}")
    return slots


def _course_from_row(
    row: dict[str, Any],
    *,
    meetings: list[dict[str, Any]],
    detail_rows: list[dict[str, Any]],
    grading_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    course = _source_payload(row)
    course["id"] = _clean(course.get("id")) or _clean(row.get("id"))
    course["_sourceIndex"] = _source_index(row, r"courses\[(\d+)\]")
    course["name"] = _clean(course.get("name")) or _clean(row.get("course_name")) or "未命名課程"
    course["credits"] = course.get("credits") if course.get("credits") is not None else _number(row.get("credits"))
    course["category"] = _clean(course.get("category")) or _clean(row.get("requirement_category")) or "unclassified"

    offering = _as_dict(course.get("scheduledOffering")).copy()
    if row.get("course_no") and not offering.get("courseNo"):
        offering["courseNo"] = row.get("course_no")
    if row.get("course_name") and not offering.get("courseName"):
        offering["courseName"] = row.get("course_name")
    if row.get("teacher") and not offering.get("teacher"):
        offering["teacher"] = row.get("teacher")
    if row.get("credits") is not None and offering.get("credits") is None:
        offering["credits"] = _number_or_none(row.get("credits"))
    if row.get("require_option") and not offering.get("requireOption"):
        offering["requireOption"] = row.get("require_option")
    if meetings and not offering.get("slots"):
        offering["slots"] = _slots_from_meetings(meetings)
    if meetings and not offering.get("classroom"):
        offering["classroom"] = _clean(meetings[0].get("room"))
    if offering:
        offering.setdefault("semester", "")
        offering.setdefault("classroom", "")
        offering.setdefault("node", ", ".join(_as_list(offering.get("slots"))))
        offering.setdefault("contents", "")
        course["scheduledOffering"] = offering

    details = _as_dict(course.get("details")).copy()
    for detail in detail_rows:
        key = _clean(detail.get("detail_key"))
        if key and key not in details:
            details[key] = detail.get("detail_value")
    if grading_rows:
        details["gradingPolicy"] = [
            {
                "id": _clean(_source_payload(item).get("id")) or _clean(item.get("id")),
                "name": _clean(item.get("item_name")) or "未命名評分項目",
                "weight": _number(item.get("weight")),
                **({"score": _number(item.get("score"))} if item.get("score") is not None else {}),
            }
            for item in sorted(grading_rows, key=lambda item: _source_index(item, r"gradingPolicy\[(\d+)\]"))
        ]
    if details:
        details.setdefault("gradingPolicy", [])
        course["details"] = details
    return course


def _history_from_row(row: dict[str, Any]) -> dict[str, Any]:
    record = _source_payload(row)
    if not record:
        passed = row.get("passed")
        record = {
            "category": _clean(row.get("requirement_category")),
            "courseCode": _clean(row.get("course_no")),
            "courseName": _clean(row.get("course_name")) or "未命名歷史課程",
            "academicTerm": _clean(row.get("term_code")),
            "grade": _clean(row.get("grade")),
            "credits": _number(row.get("credits")),
            "status": "passed" if passed is True else "failed" if passed is False else "in_progress",
        }
    return record


def _requirement_sets(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, str]]:
    sets: list[dict[str, Any]] = []
    set_id_by_row_id: dict[str, str] = {}
    for row in sorted(rows, key=lambda item: _source_index(item, r"requirementSets\[(\d+)\]")):
        source = _source_payload(row)
        set_payload = {
            "id": _clean(source.get("id")) or _clean(row.get("id")),
            "name": _clean(source.get("name")) or _clean(row.get("name")) or "未命名需求集",
            "department": source.get("department") or _clean(row.get("program_type")),
            "source": source.get("source") or _clean(row.get("source")) or "manual",
            "sourceFileName": source.get("sourceFileName"),
            "totalCredits": source.get("totalCredits"),
            "notes": _as_list(source.get("notes")),
        }
        sets.append(set_payload)
        set_id_by_row_id[_clean(row.get("id"))] = set_payload["id"]
    return sets, set_id_by_row_id


def _pending_requirements(
    requirement_rows: list[dict[str, Any]],
    option_rows: list[dict[str, Any]],
    option_course_rows: list[dict[str, Any]],
    set_id_by_row_id: dict[str, str],
) -> list[dict[str, Any]]:
    options_by_requirement: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for option in option_rows:
        options_by_requirement[_clean(option.get("requirement_id"))].append(option)

    option_courses_by_option: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for course in option_course_rows:
        option_courses_by_option[_clean(course.get("requirement_option_id"))].append(course)

    requirements: list[dict[str, Any]] = []
    for row in sorted(requirement_rows, key=lambda item: _source_index(item, r"pendingRequirements\[(\d+)\]")):
        source = _source_payload(row)
        fallback_options = []
        for option in sorted(options_by_requirement.get(_clean(row.get("id")), []), key=lambda item: _source_index(item, r"options\[(\d+)\]")):
            courses = option_courses_by_option.get(_clean(option.get("id")), [])
            fallback_options.append(
                {
                    "name": _clean(option.get("name")) or "",
                    "credits": _number_or_none(next((course.get("credits") for course in courses if course.get("credits") is not None), None)),
                    "courseNames": [_clean(course.get("course_name")) for course in courses if _clean(course.get("course_name"))],
                }
            )
        requirement = {
            "id": _clean(source.get("id")) or _clean(row.get("id")),
            "setId": source.get("setId") or set_id_by_row_id.get(_clean(row.get("requirement_set_id")), ""),
            "kind": source.get("kind") or _clean(row.get("category")) or "course",
            "title": source.get("title") or _clean(row.get("name")) or "未命名需求",
            "credits": source.get("credits"),
            "requiredCredits": source.get("requiredCredits") if source.get("requiredCredits") is not None else _number_or_none(row.get("required_credits")),
            "courseNames": _as_list(source.get("courseNames")),
            "options": _as_list(source.get("options")) or fallback_options,
            "note": source.get("note") or "",
            "courseCodePrefix": source.get("courseCodePrefix"),
        }
        requirements.append(requirement)
    return requirements


def _selection_plan(
    plan_rows: list[dict[str, Any]],
    candidate_rows: list[dict[str, Any]],
    priority_rows: list[dict[str, Any]],
    cache_rows: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not plan_rows:
        return None
    plan = sorted(plan_rows, key=lambda row: _clean(row.get("term_code")))[-1]
    source = _source_payload(plan)
    selected_candidates = [
        row for row in candidate_rows
        if _clean(row.get("selection_plan_id")) == _clean(plan.get("id")) and row.get("list_type") == "selection_plan"
    ]
    priority_by_candidate = {
        _clean(row.get("selection_candidate_id")): int(_number(row.get("priority"), 999_999))
        for row in priority_rows
    }
    courses = [
        _course_from_row(
            {
                "id": candidate.get("id"),
                "course_no": candidate.get("course_no"),
                "course_name": candidate.get("course_name"),
                "credits": candidate.get("credits"),
                "require_option": candidate.get("require_option"),
                "teacher": candidate.get("teacher"),
                "status": candidate.get("status"),
                "metadata": candidate.get("metadata"),
            },
            meetings=[],
            detail_rows=[],
            grading_rows=[],
        )
        for candidate in sorted(
            selected_candidates,
            key=lambda row: (
                priority_by_candidate.get(_clean(row.get("id")), 999_999),
                _source_index(row, r"courses\[(\d+)\]"),
            ),
        )
    ]

    cache = next((row for row in cache_rows if _clean(row.get("profile_id")) == _clean(plan.get("profile_id"))), None)
    payload = copy.deepcopy(_as_dict(cache.get("payload"))) if cache else _as_dict(source.get("officialSelectionCache"))
    result = {
        "targetAcademicTerm": source.get("targetAcademicTerm") or _clean(plan.get("term_code")),
        "targetLabel": source.get("targetLabel") or "",
        "courses": courses or _as_list(source.get("courses")),
        "officialSelectionCache": payload or None,
    }
    if source.get("updatedAt"):
        result["updatedAt"] = source["updatedAt"]
    return result


def build_app_data_from_typed_rows(rows: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    profiles = rows.get("planner_profiles", [])
    if not profiles:
        return {
            "schemaVersion": 3,
            "settings": {},
            "semesters": [],
            "requirementSets": [],
            "pendingRequirements": [],
            "historyRecords": [],
        }

    profile = profiles[0]
    source_content = _source_payload(profile)
    app_data = {
        key: copy.deepcopy(value)
        for key, value in source_content.items()
        if key not in COLLECTION_KEYS and key not in {"schoolCredentials"}
    }
    app_data["schemaVersion"] = 3
    app_data["settings"] = copy.deepcopy(_as_dict(profile.get("settings")))

    meetings_by_course: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows.get("course_meetings", []):
        meetings_by_course[_clean(row.get("course_id"))].append(row)
    details_by_course: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows.get("course_details", []):
        details_by_course[_clean(row.get("course_id"))].append(row)
    grading_by_course: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows.get("grading_items", []):
        grading_by_course[_clean(row.get("course_id"))].append(row)

    courses_by_term: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for course in rows.get("planner_courses", []):
        course_id = _clean(course.get("id"))
        courses_by_term[_clean(course.get("term_id"))].append(
            _course_from_row(
                course,
                meetings=meetings_by_course.get(course_id, []),
                detail_rows=details_by_course.get(course_id, []),
                grading_rows=grading_by_course.get(course_id, []),
            )
        )

    semesters = []
    for term in sorted(rows.get("academic_terms", []), key=lambda row: _source_index(row, r"semesters\[(\d+)\]")):
        semester = _source_payload(term)
        semester["id"] = _clean(semester.get("id")) or _clean(term.get("term_code"))
        semester["name"] = _clean(semester.get("name")) or _clean(term.get("term_label")) or semester["id"]
        semester["courses"] = sorted(
            courses_by_term.get(_clean(term.get("id")), []),
            key=lambda course: int(course.get("_sourceIndex") or 999_999),
        )
        for course in semester["courses"]:
            course.pop("_sourceIndex", None)
        semesters.append(semester)
    app_data["semesters"] = semesters

    requirement_sets, set_id_by_row_id = _requirement_sets(rows.get("requirement_sets", []))
    app_data["requirementSets"] = requirement_sets
    app_data["pendingRequirements"] = _pending_requirements(
        rows.get("requirements", []),
        rows.get("requirement_options", []),
        rows.get("requirement_option_courses", []),
        set_id_by_row_id,
    )
    app_data["historyRecords"] = [
        _history_from_row(row)
        for row in sorted(rows.get("academic_history_records", []), key=lambda item: _source_index(item, r"historyRecords\[(\d+)\]"))
    ]

    selection_plan = _selection_plan(
        rows.get("selection_plans", []),
        rows.get("selection_candidates", []),
        rows.get("selection_priorities", []),
        rows.get("official_selection_cache", []),
    )
    if selection_plan:
        for course in selection_plan["courses"]:
            if isinstance(course, dict):
                course.pop("_sourceIndex", None)
        app_data["selectionPlan"] = selection_plan
    return app_data


def read_typed_planner_app_data(user_id: str) -> dict[str, Any]:
    rows = typed_planner_repository.load_typed_planner_rows(
        user_id,
        supabase_url=SUPABASE_URL,
        headers=security.service_role_headers(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY),
        timeout=DEFAULT_TIMEOUT,
        get=requests.get,
    )
    return build_app_data_from_typed_rows(rows)
