"""Offline typed planner backfill preview and reconciliation helpers.

This module intentionally has no Supabase client, no network calls, and no
database writes. It only transforms exported ``public.user_data`` rows into
typed-table preview rows, reconciliation reports, and local backup packages.
"""

from __future__ import annotations

import copy
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


CONTRACT_VERSION = "typed-planner-backfill-preview-v1"
APPLY_PLAN_MODE = "typed_planner_apply_plan_no_database_writes"
TABLE_NAMES = [
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
]
APPLY_TABLE_ORDER = list(TABLE_NAMES)

SENSITIVE_KEYS = {"school_password", "passwordCiphertext", "apiKey"}
WEEKDAY_MAP = {"M": 1, "T": 2, "W": 3, "R": 4, "F": 5}
PACKAGE_FILES = {
    "backup": "backup-user-data.json",
    "preview": "preview.json",
    "reconciliation": "reconciliation.json",
    "manifest": "manifest.json",
}

__all__ = [
    "APPLY_PLAN_MODE",
    "APPLY_TABLE_ORDER",
    "CONTRACT_VERSION",
    "PACKAGE_FILES",
    "TABLE_NAMES",
    "build_typed_planner_apply_plan",
    "build_typed_planner_backfill_package",
    "build_typed_planner_preview",
    "build_typed_planner_reconciliation",
    "load_typed_planner_backfill_package",
    "load_user_data_rows",
    "write_typed_planner_backfill_package",
]


def _stable_uuid(*parts: object) -> str:
    name = "::".join(str(part) for part in parts)
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"course-planner-typed-preview::{name}"))


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _number_or_none(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _redacted_payload(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            if key in SENSITIVE_KEYS:
                redacted[key] = "[redacted]"
            else:
                redacted[key] = _redacted_payload(item)
        return redacted
    if isinstance(value, list):
        return [_redacted_payload(item) for item in value]
    return copy.deepcopy(value)


def _metadata(source_path: str, source_payload: Any, **extra: Any) -> dict[str, Any]:
    metadata = {
        "source_path": source_path,
        "source_payload": _redacted_payload(source_payload),
    }
    metadata.update({key: value for key, value in extra.items() if value not in (None, "")})
    return metadata


def _term_code(*values: Any) -> str:
    for value in values:
        text = _clean_text(value)
        if not text:
            continue
        match = re.search(r"\b(\d{3,4})\b", text)
        if match:
            return match.group(1)
        return text
    return "unknown"


def _department_code(course_no: str | None) -> str | None:
    if not course_no:
        return None
    match = re.match(r"([A-Za-z]+)", course_no)
    if not match and course_no[0].isdigit():
        match = re.match(r"([0-9][A-Za-z0-9]?)", course_no)
    return match.group(1).upper() if match else None


def _course_no_from_course(course: dict[str, Any]) -> str | None:
    offering = _as_dict(course.get("scheduledOffering"))
    for value in (offering.get("courseNo"), course.get("courseNo"), course.get("course_no"), course.get("id")):
        text = _clean_text(value)
        if re.match(r"^[A-Za-z0-9]{2,12}$", text):
            return text
    return None


def _course_name_from_course(course: dict[str, Any]) -> str:
    offering = _as_dict(course.get("scheduledOffering"))
    return _clean_text(offering.get("courseName") or course.get("name") or course.get("course_name")) or "未命名課程"


def _parse_slot(slot: Any) -> tuple[int | None, str | None]:
    text = _clean_text(slot)
    match = re.match(r"^([MTWRF])\s*(.+)$", text, flags=re.IGNORECASE)
    if not match:
        return None, text or None
    return WEEKDAY_MAP.get(match.group(1).upper()), match.group(2).strip()


def _append_row(tables: dict[str, list[dict[str, Any]]], table_name: str, row: dict[str, Any]) -> None:
    tables[table_name].append(row)


def _selection_course_row(
    *,
    candidate_id: str,
    selection_plan_id: str,
    course_no: str | None,
    course_name: str,
    list_type: str,
    source_payload: Any,
    source_path: str,
    credits: Any = None,
    require_option: Any = None,
    department_code: str | None = None,
    teacher: Any = None,
    status: Any = None,
    gpa: Any = None,
    gpa_status: Any = None,
) -> dict[str, Any]:
    return {
        "id": candidate_id,
        "selection_plan_id": selection_plan_id,
        "course_no": course_no,
        "course_name": course_name,
        "credits": _number_or_none(credits),
        "require_option": _clean_text(require_option) or None,
        "department_code": department_code or _department_code(course_no),
        "teacher": _clean_text(teacher) or None,
        "status": _clean_text(status) or None,
        "list_type": list_type,
        "gpa": _number_or_none(gpa),
        "gpa_status": _clean_text(gpa_status) or None,
        "metadata": _metadata(source_path, source_payload),
    }


def _preview_semesters(
    *,
    tables: dict[str, list[dict[str, Any]]],
    user_id: str,
    profile_id: str,
    content: dict[str, Any],
    source_counts: dict[str, int],
) -> None:
    semesters = _as_list(content.get("semesters"))
    source_counts["semesters"] += len(semesters)
    for term_index, semester in enumerate(semesters):
        if not isinstance(semester, dict):
            continue
        term = _term_code(semester.get("id"), semester.get("name"))
        term_id = _stable_uuid(user_id, "term", semester.get("id") or term_index)
        _append_row(
            tables,
            "academic_terms",
            {
                "id": term_id,
                "profile_id": profile_id,
                "term_code": term,
                "term_label": _clean_text(semester.get("name")) or None,
                "metadata": _metadata(f"content.semesters[{term_index}]", semester),
            },
        )

        courses = _as_list(semester.get("courses"))
        source_counts["semester_courses"] += len(courses)
        for course_index, course in enumerate(courses):
            if not isinstance(course, dict):
                continue
            offering = _as_dict(course.get("scheduledOffering"))
            course_no = _course_no_from_course(course)
            course_id = _stable_uuid(user_id, "semester-course", semester.get("id") or term_index, course.get("id") or course_index)
            course_name = _course_name_from_course(course)
            _append_row(
                tables,
                "planner_courses",
                {
                    "id": course_id,
                    "term_id": term_id,
                    "course_no": course_no,
                    "course_name": course_name,
                    "credits": _number_or_none(course.get("credits") or offering.get("credits")),
                    "requirement_category": _clean_text(course.get("category")) or None,
                    "require_option": _clean_text(offering.get("requireOption")) or None,
                    "department_code": _department_code(course_no),
                    "teacher": _clean_text(offering.get("teacher")) or None,
                    "status": _clean_text(_as_dict(course.get("virtualSelection")).get("status")) or None,
                    "source": "legacy_semester",
                    "metadata": _metadata(f"content.semesters[{term_index}].courses[{course_index}]", course),
                },
            )

            for slot_index, slot in enumerate(_as_list(offering.get("slots"))):
                weekday, period = _parse_slot(slot)
                _append_row(
                    tables,
                    "course_meetings",
                    {
                        "id": _stable_uuid(user_id, "meeting", course_id, slot_index, slot),
                        "course_id": course_id,
                        "weekday": weekday,
                        "period": period,
                        "room": _clean_text(offering.get("classroom")) or None,
                        "raw_time": _clean_text(slot) or None,
                        "metadata": _metadata(
                            f"content.semesters[{term_index}].courses[{course_index}].scheduledOffering.slots[{slot_index}]",
                            slot,
                            source_course_no=course_no,
                        ),
                    },
                )

            details = _as_dict(course.get("details"))
            for detail_key, detail_value in details.items():
                if detail_key == "gradingPolicy":
                    continue
                if detail_value in (None, ""):
                    continue
                _append_row(
                    tables,
                    "course_details",
                    {
                        "id": _stable_uuid(user_id, "detail", course_id, detail_key),
                        "course_id": course_id,
                        "detail_key": detail_key,
                        "detail_value": detail_value,
                        "metadata": _metadata(
                            f"content.semesters[{term_index}].courses[{course_index}].details.{detail_key}",
                            detail_value,
                        ),
                    },
                )

            for grading_index, grading_item in enumerate(_as_list(details.get("gradingPolicy"))):
                if not isinstance(grading_item, dict):
                    continue
                _append_row(
                    tables,
                    "grading_items",
                    {
                        "id": _stable_uuid(user_id, "grading", course_id, grading_item.get("id") or grading_index),
                        "course_id": course_id,
                        "item_name": _clean_text(grading_item.get("name")) or "未命名評分項目",
                        "weight": _number_or_none(grading_item.get("weight")),
                        "score": _number_or_none(grading_item.get("score")),
                        "metadata": _metadata(
                            f"content.semesters[{term_index}].courses[{course_index}].details.gradingPolicy[{grading_index}]",
                            grading_item,
                        ),
                    },
                )


def _preview_requirements(
    *,
    tables: dict[str, list[dict[str, Any]]],
    user_id: str,
    profile_id: str,
    content: dict[str, Any],
    source_counts: dict[str, int],
    warnings: list[str],
) -> None:
    requirement_set_ids: dict[str, str] = {}
    requirement_sets = _as_list(content.get("requirementSets"))
    source_counts["requirement_sets"] += len(requirement_sets)
    for set_index, requirement_set in enumerate(requirement_sets):
        if not isinstance(requirement_set, dict):
            continue
        source_set_id = _clean_text(requirement_set.get("id")) or str(set_index)
        row_id = _stable_uuid(user_id, "requirement-set", source_set_id)
        requirement_set_ids[source_set_id] = row_id
        _append_row(
            tables,
            "requirement_sets",
            {
                "id": row_id,
                "profile_id": profile_id,
                "name": _clean_text(requirement_set.get("name")) or "未命名需求集",
                "program_type": _clean_text(requirement_set.get("department")) or None,
                "source": _clean_text(requirement_set.get("source")) or None,
                "metadata": _metadata(f"content.requirementSets[{set_index}]", requirement_set),
            },
        )

    pending_requirements = _as_list(content.get("pendingRequirements"))
    source_counts["pending_requirements"] += len(pending_requirements)
    for requirement_index, requirement in enumerate(pending_requirements):
        if not isinstance(requirement, dict):
            continue
        source_set_id = _clean_text(requirement.get("setId"))
        requirement_set_id = requirement_set_ids.get(source_set_id)
        if not requirement_set_id:
            warnings.append(f"pendingRequirements[{requirement_index}] skipped: missing requirement set {source_set_id!r}")
            continue

        source_requirement_id = _clean_text(requirement.get("id")) or str(requirement_index)
        requirement_id = _stable_uuid(user_id, "requirement", source_requirement_id)
        _append_row(
            tables,
            "requirements",
            {
                "id": requirement_id,
                "requirement_set_id": requirement_set_id,
                "name": _clean_text(requirement.get("title")) or "未命名需求",
                "category": _clean_text(requirement.get("kind")) or None,
                "required_credits": _number_or_none(requirement.get("requiredCredits") or requirement.get("credits")),
                "required_count": len(_as_list(requirement.get("courseNames"))) or None,
                "metadata": _metadata(f"content.pendingRequirements[{requirement_index}]", requirement),
            },
        )

        raw_options = _as_list(requirement.get("options"))
        options = raw_options or [
            {
                "name": _clean_text(requirement.get("title")) or "課程選項",
                "credits": requirement.get("credits"),
                "courseNames": _as_list(requirement.get("courseNames")),
            }
        ]
        for option_index, option in enumerate(options):
            if not isinstance(option, dict):
                continue
            option_id = _stable_uuid(user_id, "requirement-option", requirement_id, option_index)
            _append_row(
                tables,
                "requirement_options",
                {
                    "id": option_id,
                    "requirement_id": requirement_id,
                    "option_group": _clean_text(requirement.get("kind")) or None,
                    "name": _clean_text(option.get("name")) or None,
                    "metadata": _metadata(
                        f"content.pendingRequirements[{requirement_index}].options[{option_index}]",
                        option,
                        source_requirement_id=source_requirement_id,
                    ),
                },
            )
            for course_index, course_name in enumerate(_as_list(option.get("courseNames"))):
                clean_course_name = _clean_text(course_name)
                if not clean_course_name:
                    continue
                _append_row(
                    tables,
                    "requirement_option_courses",
                    {
                        "id": _stable_uuid(user_id, "requirement-option-course", option_id, course_index, clean_course_name),
                        "requirement_option_id": option_id,
                        "course_no": None,
                        "course_name": clean_course_name,
                        "credits": _number_or_none(option.get("credits")),
                        "metadata": _metadata(
                            f"content.pendingRequirements[{requirement_index}].options[{option_index}].courseNames[{course_index}]",
                            course_name,
                        ),
                    },
                )


def _preview_history(
    *,
    tables: dict[str, list[dict[str, Any]]],
    user_id: str,
    profile_id: str,
    content: dict[str, Any],
    source_counts: dict[str, int],
) -> None:
    records = _as_list(content.get("historyRecords"))
    source_counts["history_records"] += len(records)
    for record_index, record in enumerate(records):
        if not isinstance(record, dict):
            continue
        status = _clean_text(record.get("status"))
        _append_row(
            tables,
            "academic_history_records",
            {
                "id": _stable_uuid(user_id, "history", record.get("courseCode"), record.get("academicTerm"), record_index),
                "profile_id": profile_id,
                "term_code": _term_code(record.get("academicTerm")),
                "course_no": _clean_text(record.get("courseCode")) or None,
                "course_name": _clean_text(record.get("courseName")) or "未命名歷史課程",
                "credits": _number_or_none(record.get("credits")),
                "grade": _clean_text(record.get("grade")) or None,
                "requirement_category": _clean_text(record.get("category")) or None,
                "passed": True if status == "passed" else False if status in {"failed", "in_progress"} else None,
                "metadata": _metadata(f"content.historyRecords[{record_index}]", record),
            },
        )


def _preview_selection_plan(
    *,
    tables: dict[str, list[dict[str, Any]]],
    user_id: str,
    profile_id: str,
    content: dict[str, Any],
    source_counts: dict[str, int],
) -> None:
    selection_plan = content.get("selectionPlan")
    if not isinstance(selection_plan, dict):
        return

    term = _term_code(selection_plan.get("targetAcademicTerm"), selection_plan.get("targetLabel"))
    plan_id = _stable_uuid(user_id, "selection-plan", term, "initial")
    _append_row(
        tables,
        "selection_plans",
        {
            "id": plan_id,
            "profile_id": profile_id,
            "term_code": term,
            "phase": "initial",
            "source": "legacy_selection_plan",
            "metadata": _metadata("content.selectionPlan", selection_plan),
        },
    )

    for course_index, course in enumerate(_as_list(selection_plan.get("courses"))):
        if not isinstance(course, dict):
            continue
        course_no = _course_no_from_course(course)
        course_name = _course_name_from_course(course)
        candidate_id = _stable_uuid(user_id, "selection-course", course.get("id") or course_no or course_name, course_index)
        virtual_selection = _as_dict(course.get("virtualSelection"))
        _append_row(
            tables,
            "selection_candidates",
            _selection_course_row(
                candidate_id=candidate_id,
                selection_plan_id=plan_id,
                course_no=course_no,
                course_name=course_name,
                credits=course.get("credits"),
                require_option=_as_dict(course.get("scheduledOffering")).get("requireOption"),
                teacher=_as_dict(course.get("scheduledOffering")).get("teacher"),
                status=virtual_selection.get("status"),
                list_type="selection_plan",
                source_payload=course,
                source_path=f"content.selectionPlan.courses[{course_index}]",
            ),
        )
        source_counts["selection_courses"] += 1
        if not virtual_selection:
            _append_row(
                tables,
                "selection_priorities",
                {
                    "id": _stable_uuid(user_id, "selection-priority", candidate_id),
                    "selection_plan_id": plan_id,
                    "selection_candidate_id": candidate_id,
                    "priority": course_index + 1,
                    "source": "legacy_selection_plan",
                    "metadata": _metadata(f"content.selectionPlan.courses[{course_index}]", course),
                },
            )

    official_cache = selection_plan.get("officialSelectionCache")
    if not isinstance(official_cache, dict):
        return

    _append_row(
        tables,
        "official_selection_cache",
        {
            "id": _stable_uuid(user_id, "official-selection-cache", term),
            "profile_id": profile_id,
            "school_account": _clean_text(official_cache.get("school_account")) or None,
            "term_code": term,
            "payload": _redacted_payload(official_cache),
            "synced_at": _clean_text(official_cache.get("synced_at")) or None,
            "metadata": _metadata("content.selectionPlan.officialSelectionCache", official_cache),
        },
    )

    for list_type, key in (
        ("registered", "registered_courses"),
        ("available", "available_courses"),
        ("required_preset", "required_preset_courses"),
    ):
        courses = _as_list(official_cache.get(key))
        source_counts[f"official_{key}"] += len(courses)
        for course_index, course in enumerate(courses):
            if not isinstance(course, dict):
                continue
            course_no = _clean_text(course.get("course_no")) or None
            course_name = _clean_text(course.get("course_name")) or "未命名官方課程"
            candidate_id = _stable_uuid(user_id, "official-selection", list_type, course_no or course_name, course_index)
            _append_row(
                tables,
                "selection_candidates",
                _selection_course_row(
                    candidate_id=candidate_id,
                    selection_plan_id=plan_id,
                    course_no=course_no,
                    course_name=course_name,
                    credits=course.get("credits"),
                    require_option=course.get("require_option"),
                    teacher=course.get("teacher"),
                    status=list_type,
                    list_type=list_type,
                    gpa=course.get("gpa"),
                    gpa_status=course.get("gpa_status"),
                    source_payload=course,
                    source_path=f"content.selectionPlan.officialSelectionCache.{key}[{course_index}]",
                ),
            )
            priority = _number_or_none(course.get("priority"))
            if list_type == "registered" and priority is not None:
                _append_row(
                    tables,
                    "selection_priorities",
                    {
                        "id": _stable_uuid(user_id, "official-priority", candidate_id),
                        "selection_plan_id": plan_id,
                        "selection_candidate_id": candidate_id,
                        "priority": int(priority),
                        "source": "official_selection_cache",
                        "metadata": _metadata(
                            f"content.selectionPlan.officialSelectionCache.{key}[{course_index}]",
                            course,
                        ),
                    },
                )


def _preview_user_content(
    *,
    row_index: int,
    user_id: str,
    content: dict[str, Any],
    tables: dict[str, list[dict[str, Any]]],
    source_counts: dict[str, int],
    warnings: list[str],
) -> None:
    settings = _as_dict(content.get("settings"))
    profile_id = _stable_uuid(user_id, "profile", "default")
    _append_row(
        tables,
        "planner_profiles",
        {
            "id": profile_id,
            "user_id": user_id,
            "profile_key": "default",
            "display_name": None,
            "school_account": _clean_text(settings.get("school_account")) or None,
            "settings": _redacted_payload(settings),
            "metadata": _metadata(f"rows[{row_index}].content", content),
        },
    )

    _preview_semesters(
        tables=tables,
        user_id=user_id,
        profile_id=profile_id,
        content=content,
        source_counts=source_counts,
    )
    _preview_requirements(
        tables=tables,
        user_id=user_id,
        profile_id=profile_id,
        content=content,
        source_counts=source_counts,
        warnings=warnings,
    )
    _preview_history(
        tables=tables,
        user_id=user_id,
        profile_id=profile_id,
        content=content,
        source_counts=source_counts,
    )
    _preview_selection_plan(
        tables=tables,
        user_id=user_id,
        profile_id=profile_id,
        content=content,
        source_counts=source_counts,
    )


def build_typed_planner_preview(rows: list[dict[str, Any]], *, include_rows: bool = True) -> dict[str, Any]:
    tables: dict[str, list[dict[str, Any]]] = {name: [] for name in TABLE_NAMES}
    source_counts = {
        "input_rows": len(rows),
        "valid_user_rows": 0,
        "semesters": 0,
        "semester_courses": 0,
        "requirement_sets": 0,
        "pending_requirements": 0,
        "history_records": 0,
        "selection_courses": 0,
        "official_registered_courses": 0,
        "official_available_courses": 0,
        "official_required_preset_courses": 0,
    }
    warnings: list[str] = []

    for row_index, row in enumerate(rows):
        if not isinstance(row, dict):
            warnings.append(f"rows[{row_index}] skipped: row is not an object")
            continue
        user_id = _clean_text(row.get("user_id"))
        content = row.get("content")
        if isinstance(content, str):
            try:
                content = json.loads(content)
            except json.JSONDecodeError:
                warnings.append(f"rows[{row_index}] skipped: content string is not valid JSON")
                continue
        if not user_id or not isinstance(content, dict):
            warnings.append(f"rows[{row_index}] skipped: missing user_id or object content")
            continue
        source_counts["valid_user_rows"] += 1
        _preview_user_content(
            row_index=row_index,
            user_id=user_id,
            content=content,
            tables=tables,
            source_counts=source_counts,
            warnings=warnings,
        )

    counts = {table_name: len(rows_for_table) for table_name, rows_for_table in tables.items()}
    preview: dict[str, Any] = {
        "contract_version": CONTRACT_VERSION,
        "mode": "preview_only_no_database_writes",
        "counts": counts,
        "source_counts": source_counts,
        "warnings": warnings,
    }
    if include_rows:
        preview["tables"] = tables
    return preview


def build_typed_planner_reconciliation(preview: dict[str, Any]) -> dict[str, Any]:
    counts = _as_dict(preview.get("counts"))
    source_counts = _as_dict(preview.get("source_counts"))
    warnings = _as_list(preview.get("warnings"))

    def count(key: str) -> int:
        value = source_counts.get(key) if key in source_counts else counts.get(key)
        return int(value) if isinstance(value, int) else 0

    def table_count(key: str) -> int:
        value = counts.get(key)
        return int(value) if isinstance(value, int) else 0

    expected_selection_candidates = (
        count("selection_courses")
        + count("official_registered_courses")
        + count("official_available_courses")
        + count("official_required_preset_courses")
    )
    checks = [
        {
            "name": "valid_users_to_profiles",
            "source_count": count("valid_user_rows"),
            "target_count": table_count("planner_profiles"),
        },
        {
            "name": "semesters_to_academic_terms",
            "source_count": count("semesters"),
            "target_count": table_count("academic_terms"),
        },
        {
            "name": "semester_courses_to_planner_courses",
            "source_count": count("semester_courses"),
            "target_count": table_count("planner_courses"),
        },
        {
            "name": "requirement_sets_to_requirement_sets",
            "source_count": count("requirement_sets"),
            "target_count": table_count("requirement_sets"),
        },
        {
            "name": "pending_requirements_to_requirements",
            "source_count": count("pending_requirements"),
            "target_count": table_count("requirements"),
        },
        {
            "name": "history_records_to_academic_history_records",
            "source_count": count("history_records"),
            "target_count": table_count("academic_history_records"),
        },
        {
            "name": "selection_sources_to_selection_candidates",
            "source_count": expected_selection_candidates,
            "target_count": table_count("selection_candidates"),
        },
    ]
    for check in checks:
        check["status"] = "passed" if check["source_count"] == check["target_count"] else "mismatch"

    has_mismatch = any(check["status"] != "passed" for check in checks)
    status = "failed" if has_mismatch else "review_required" if warnings else "passed"
    return {
        "contract_version": CONTRACT_VERSION,
        "mode": "preview_reconciliation_no_database_writes",
        "status": status,
        "checks": checks,
        "warnings": warnings,
    }


def build_typed_planner_backfill_package(
    rows: list[dict[str, Any]],
    *,
    include_rows: bool = True,
    generated_at: str | None = None,
) -> dict[str, Any]:
    generated_at = generated_at or datetime.now(timezone.utc).isoformat()
    preview = build_typed_planner_preview(rows, include_rows=include_rows)
    reconciliation = build_typed_planner_reconciliation(preview)
    backup = {
        "contract_version": CONTRACT_VERSION,
        "mode": "raw_user_data_backup",
        "contains_sensitive_source_data": True,
        "row_count": len(rows),
        "rows": copy.deepcopy(rows),
    }
    manifest = {
        "contract_version": CONTRACT_VERSION,
        "mode": "typed_planner_backfill_package",
        "generated_at": generated_at,
        "status": reconciliation["status"],
        "contains_sensitive_backup": True,
        "database_writes": False,
        "files": PACKAGE_FILES,
        "input_row_count": len(rows),
        "counts": preview["counts"],
        "source_counts": preview["source_counts"],
        "warning_count": len(preview["warnings"]),
    }
    return {
        "backup": backup,
        "preview": preview,
        "reconciliation": reconciliation,
        "manifest": manifest,
    }


def _require_package_contract(package: dict[str, Any]) -> None:
    for key in ("manifest", "preview", "reconciliation"):
        payload = _as_dict(package.get(key))
        if payload.get("contract_version") != CONTRACT_VERSION:
            raise ValueError(f"apply plan requires {key}.contract_version {CONTRACT_VERSION!r}")

    manifest = _as_dict(package.get("manifest"))
    if manifest.get("database_writes") is not False:
        raise ValueError("apply plan requires a no-write backfill package")

    reconciliation = _as_dict(package.get("reconciliation"))
    if reconciliation.get("status") != "passed":
        raise ValueError("apply plan requires passed reconciliation")

    preview = _as_dict(package.get("preview"))
    if not isinstance(preview.get("tables"), dict):
        raise ValueError("apply plan requires preview tables; rebuild without --counts-only")


def build_typed_planner_apply_plan(package: dict[str, Any]) -> dict[str, Any]:
    """Build an ordered no-write plan from a verified backfill preview package."""
    _require_package_contract(package)

    preview = _as_dict(package.get("preview"))
    manifest = _as_dict(package.get("manifest"))
    counts = _as_dict(preview.get("counts"))
    operations = [
        {
            "order": order,
            "table": table_name,
            "operation": "upsert_preview_rows",
            "row_count": int(counts.get(table_name) or 0),
        }
        for order, table_name in enumerate(APPLY_TABLE_ORDER, start=1)
    ]
    return {
        "contract_version": CONTRACT_VERSION,
        "mode": APPLY_PLAN_MODE,
        "database_writes": False,
        "status": "ready",
        "source_manifest_status": manifest.get("status"),
        "operations": operations,
        "total_row_count": sum(operation["row_count"] for operation in operations),
        "warnings": [],
    }


def _write_json_file(path: Path, payload: dict[str, Any], *, force: bool) -> None:
    if path.exists() and not force:
        raise FileExistsError(f"{path} already exists; pass --force to overwrite")
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def load_typed_planner_backfill_package(package_dir: Path) -> dict[str, Any]:
    package: dict[str, Any] = {}
    for key, filename in PACKAGE_FILES.items():
        payload = json.loads((package_dir / filename).read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError(f"{filename} must contain a JSON object")
        package[key] = payload
    return package


def write_typed_planner_backfill_package(
    rows: list[dict[str, Any]],
    package_dir: Path,
    *,
    include_rows: bool = True,
    force: bool = False,
) -> dict[str, Any]:
    package = build_typed_planner_backfill_package(rows, include_rows=include_rows)
    package_dir.mkdir(parents=True, exist_ok=True)
    if not force:
        existing_files = [package_dir / filename for filename in PACKAGE_FILES.values() if (package_dir / filename).exists()]
        if existing_files:
            existing = ", ".join(str(path) for path in existing_files)
            raise FileExistsError(f"package files already exist: {existing}; pass --force to overwrite")
    for key, filename in PACKAGE_FILES.items():
        _write_json_file(package_dir / filename, package[key], force=force)
    return package["manifest"]


def load_user_data_rows(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        rows = payload.get("rows")
        if isinstance(rows, list):
            return rows
    raise ValueError("input JSON must be a list of user_data rows or an object with a rows list")
