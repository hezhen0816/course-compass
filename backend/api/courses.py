from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

import requests
from fastapi import APIRouter, Header, HTTPException, Query

try:
    from ..config import DEFAULT_VERIFY_SSL
    from ..monitor.semester import fetch_semesters_info, get_default_semester
    from ..course_capacity import ADD_DROP_PERIOD, capacity_limit, selected_count
    from ..gpa import fetch_gpa_history, fetch_section_gpas
    from ..models import CourseSearchResult, CourseSemesterInfo, GpaHistoryResponse, GpaHistoryRowPayload
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from config import DEFAULT_VERIFY_SSL
    from monitor.semester import fetch_semesters_info, get_default_semester
    from course_capacity import ADD_DROP_PERIOD, capacity_limit, selected_count
    from gpa import fetch_gpa_history, fetch_section_gpas
    from models import CourseSearchResult, CourseSemesterInfo, GpaHistoryResponse, GpaHistoryRowPayload


CourseSearchFetcher = Callable[..., list[dict[str, Any]]]
GpaApiKeyReader = Callable[[str | None], str]


def create_courses_router(
    fetch_courses_filtered: CourseSearchFetcher,
    read_gpa_api_key: GpaApiKeyReader | None = None,
    fetch_all_courses: Callable[[str, bool, bool], list[dict[str, Any]]] | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/api/courses", tags=["courses"])

    @router.get("/semesters", response_model=list[CourseSemesterInfo])
    def get_course_semesters() -> list[CourseSemesterInfo]:
        try:
            # 共用 backend/monitor/semester.py 的抓取與快取，不再各自打一次 semestersinfo
            semesters = list(fetch_semesters_info(verify_ssl=DEFAULT_VERIFY_SSL))
            # 學校對 25 個學期都標 CurrentSemester=true / Static=false，單看欄位分不出來；
            # 真正的當前學期以 monitor/semester.py 的判定為準（取清單第一筆有效值），
            # 否則前端的「current」會有 25 個，只是碰巧靠順序取到對的。
            current_semester = get_default_semester(verify_ssl=DEFAULT_VERIFY_SSL)
            return [
                CourseSemesterInfo(
                    semester=str(item.get("Semester") or ""),
                    english_label=str(item.get("EngSemester") or ""),
                    current=str(item.get("Semester") or "").strip() == current_semester,
                )
                for item in semesters
                if item.get("Semester")
            ]
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"課程查詢系統請求失敗：{exc}") from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/search", response_model=list[CourseSearchResult])
    def search_courses(
        semester: str,
        q: str = "",
        mode: str = "name",
        teacher: str = "",
        node: str = "",
        dimension: str = "",
        only_general: bool = False,
        only_undergraduate: bool = False,
        only_master: bool = False,
        refresh: bool = False,
        include_cross_school: bool = False,
        authorization: str | None = Header(default=None),
    ) -> list[CourseSearchResult]:
        """課名／課號、教師、節次、通識、向度、學制任一條件都能單獨查。

        `q` 不再是必填——「這學期週五 1-4 節有哪些課」這種問題本來就沒有課名可填。
        但至少要有一個條件：無條件整包撈是 2190 門、1.1 MB、學校端 37 秒，不該讓它隨手發生。
        """
        try:
            if mode not in {"name", "code"}:
                raise RuntimeError("mode 只能是 name 或 code。")
            wanted_nodes = _parse_node_filter(node)
            if not any([q.strip(), teacher.strip(), wanted_nodes, dimension.strip(), only_general]):
                raise RuntimeError("請至少給一個條件：課名／課號、教師、節次、通識或向度。")
            narrows_at_school = any([q.strip(), teacher.strip(), dimension.strip(), only_general])
            if narrows_at_school:
                courses = fetch_courses_filtered(
                    semester,
                    course_no=q.strip() if mode == "code" else "",
                    course_name=q.strip() if mode == "name" else "",
                    teacher=teacher.strip(),
                    dimension=dimension.strip().upper(),
                    only_general=only_general,
                    only_undergraduate=only_undergraduate,
                    only_master=only_master,
                    verify_ssl=DEFAULT_VERIFY_SSL,
                    include_cross_school=include_cross_school,
                )
            else:
                # 只有節次時學校端沒東西可篩，等於整包撈：2190 門、1.1 MB、37 秒，
                # 會直接撞上 30 秒逾時。走 fetch_all_courses 的 30 分鐘快取與加長逾時，
                # 第一次慢一次，之後同一學期的節次查詢都是本機篩。
                courses = fetch_all_courses(semester, refresh, DEFAULT_VERIFY_SSL)
            normalized_query = _normalize_course_lookup_text(q)
            filtered = []
            for course in courses:
                course_no = str(course.get("CourseNo") or "")
                course_name = str(course.get("CourseName") or "")
                normalized_course_name = _normalize_course_lookup_text(course_name)
                normalized_course_no = _normalize_course_lookup_text(course_no)
                if q.strip() and mode == "name" and normalized_query not in normalized_course_name:
                    continue
                if q.strip() and mode == "code" and normalized_query not in normalized_course_no:
                    continue
                if wanted_nodes and not _matches_nodes(course, wanted_nodes):
                    continue
                filtered.append(_course_search_result(course))
            results = _sort_course_search_results(_merge_course_search_results(filtered), q)
            # GPA 密鑰由後端從 app_private 解密取得，前端不經手
            gpa_api_key = read_gpa_api_key(authorization) if read_gpa_api_key else ""
            if gpa_api_key:
                _attach_gpa_to_courses(results, gpa_api_key, DEFAULT_VERIFY_SSL)
            return results
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"課程查詢系統請求失敗：{exc}") from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/gpa-history", response_model=GpaHistoryResponse)
    def get_gpa_history(
        name: str = Query(min_length=1),
        authorization: str | None = Header(default=None),
    ) -> GpaHistoryResponse:
        """歷年同名課程每一班的 GPA；需要登入且已啟用 myNTUST 密鑰。"""
        course_name = name.strip()
        gpa_api_key = read_gpa_api_key(authorization) if read_gpa_api_key else ""
        if not gpa_api_key:
            return GpaHistoryResponse(course_name=course_name, status="not_enabled")
        rows, status = fetch_gpa_history(course_name, gpa_api_key, DEFAULT_VERIFY_SSL)
        return GpaHistoryResponse(
            course_name=course_name,
            status=status,
            rows=[GpaHistoryRowPayload(**row.as_fields()) for row in rows or []],
        )

    return router



def _parse_node_filter(value: str) -> set[str]:
    """'F1,F2 F3、F4' → {'F1','F2','F3','F4'}。空字串＝不限。"""
    return {part.strip().upper() for part in re.split(r"[,、\s]+", value or "") if part.strip()}


def _matches_nodes(course: dict[str, Any], wanted: set[str]) -> bool:
    """這門課的所有上課節次都落在 wanted 之內才算符合。

    用「全部落在」而不是「有碰到」：想找週五 1-4 節的課，是為了填滿那段空檔，
    一門延伸到週三的課碰到 F1 也不該算進來。沒有節次的課（未排時間）一律不符合。
    """
    nodes = {part.strip().upper() for part in re.split(r"[,、\s]+", str(course.get("Node") or "")) if part.strip()}
    return bool(nodes) and nodes <= wanted


def _attach_gpa_to_courses(courses: list[CourseSearchResult], api_key: str, verify_ssl: bool) -> None:
    sections = [(course.course_no, course.course_name, course.teacher) for course in courses if course.course_no]
    results = fetch_section_gpas(sections, api_key, verify_ssl)
    for course in courses:
        if not course.course_no:
            continue
        result = results.get(course.course_no.strip().upper())
        if result is None:
            course.gpa, course.gpa_status = None, "error"
            continue
        for field, value in result.as_fields().items():
            setattr(course, field, value)


def _as_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_course_lookup_text(value: str) -> str:
    return value.strip().replace(" ", "").replace("（", "(").replace("）", ")").lower()


def _course_search_result(course: dict[str, Any]) -> CourseSearchResult:
    return CourseSearchResult(
        semester=str(course.get("Semester") or ""),
        course_no=str(course.get("CourseNo") or ""),
        course_name=str(course.get("CourseName") or ""),
        teacher=str(course.get("CourseTeacher") or ""),
        dimension=str(course.get("Dimension") or ""),
        credits=_as_float(course.get("CreditPoint")),
        require_option=str(course.get("RequireOption") or ""),
        classroom=str(course.get("ClassRoomNo") or ""),
        node=str(course.get("Node") or ""),
        contents=str(course.get("Contents") or ""),
        selected_count=selected_count(course),
        # 加退選上限優先，該欄位為 9999／空值時退回初選上限（見 backend/course_capacity.py）
        capacity=capacity_limit(course, ADD_DROP_PERIOD),
    )


def _merge_course_search_results(courses: list[CourseSearchResult]) -> list[CourseSearchResult]:
    merged: dict[tuple[str, str, str, str, str], CourseSearchResult] = {}

    for course in courses:
        key = (
            course.semester,
            course.course_no,
            course.course_name,
            course.teacher,
            course.require_option,
        )
        existing = merged.get(key)
        if existing is None:
            merged[key] = course.model_copy()
            continue

        existing.node = _merge_token_text(existing.node, course.node)
        existing.classroom = _merge_token_text(existing.classroom, course.classroom)
        existing.contents = _merge_note_text(existing.contents, course.contents)
        existing.dimension = existing.dimension or course.dimension
        existing.selected_count = _max_optional_int(existing.selected_count, course.selected_count)
        existing.capacity = _max_optional_int(existing.capacity, course.capacity)

    return list(merged.values())


def _sort_course_search_results(courses: list[CourseSearchResult], query: str) -> list[CourseSearchResult]:
    normalized_query = _normalize_course_lookup_text(query)
    return sorted(
        courses,
        key=lambda course: (
            _normalize_course_lookup_text(course.course_name) != normalized_query,
            course.course_no,
            course.course_name,
            course.teacher,
        ),
    )


def _merge_token_text(left: str, right: str) -> str:
    tokens: list[str] = []
    seen: set[str] = set()
    for value in (left, right):
        for token in re.split(r"[,、/\s]+", value):
            normalized = token.strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            tokens.append(normalized)
    return ", ".join(tokens)


def _merge_note_text(left: str, right: str) -> str:
    notes: list[str] = []
    for note in (left.strip(), right.strip()):
        if note and note not in notes:
            notes.append(note)
    return "；".join(notes)


def _max_optional_int(left: int | None, right: int | None) -> int | None:
    values = [value for value in (left, right) if value is not None]
    return max(values) if values else None
