from __future__ import annotations

import re
from typing import Any

import requests
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

try:
    from .config import DEFAULT_VERIFY_SSL, SEMESTERS_INFO_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
    from .history import fetch_history_records
    from .models import (
        HistoryImportRequest,
        HistoryImportResponse,
        MoodleAssignmentsRequest,
        MoodleAssignmentsResponse,
        CourseSearchResult,
        CourseSemesterInfo,
        RequirementPdfImportResponse,
        SyncRequest,
        SyncResponse,
        TRRoomStatusResponse,
    )
    from .moodle import fetch_moodle_assignments
    from .planner_pdf import parse_requirement_pdf
    from .schedule import fetch_schedule
    from .snapshots import (
        ensure_schedule_entry_slot_times,
        load_history_snapshot,
        load_moodle_assignments_snapshot,
        load_snapshot,
        persist_history_snapshot,
        persist_moodle_assignments_snapshot,
        persist_snapshot,
    )
    from .time_utils import now
    from .tr_rooms import (
        build_tr_meetings,
        fetch_current_query_semester,
        fetch_query_courses,
        fetch_query_courses_filtered,
        label_for_node,
        next_node_from_datetime,
        node_from_datetime,
        normalize_room_code,
        occupied_meetings,
        room_sort_key,
    )
except ImportError:  # pragma: no cover - supports Railway backend/ cwd imports.
    from config import DEFAULT_VERIFY_SSL, SEMESTERS_INFO_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
    from history import fetch_history_records
    from models import (
        HistoryImportRequest,
        HistoryImportResponse,
        MoodleAssignmentsRequest,
        MoodleAssignmentsResponse,
        CourseSearchResult,
        CourseSemesterInfo,
        RequirementPdfImportResponse,
        SyncRequest,
        SyncResponse,
        TRRoomStatusResponse,
    )
    from moodle import fetch_moodle_assignments
    from planner_pdf import parse_requirement_pdf
    from schedule import fetch_schedule
    from snapshots import (
        ensure_schedule_entry_slot_times,
        load_history_snapshot,
        load_moodle_assignments_snapshot,
        load_snapshot,
        persist_history_snapshot,
        persist_moodle_assignments_snapshot,
        persist_snapshot,
    )
    from time_utils import now
    from tr_rooms import (
        build_tr_meetings,
        fetch_current_query_semester,
        fetch_query_courses,
        fetch_query_courses_filtered,
        label_for_node,
        next_node_from_datetime,
        node_from_datetime,
        normalize_room_code,
        occupied_meetings,
        room_sort_key,
    )


app = FastAPI(title="Course Compass Sync API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://course-planner-web.vercel.app",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app|http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def healthcheck() -> dict[str, Any]:
    return {
        "ok": True,
        "supabase_configured": bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY),
        "timestamp": now().isoformat(),
    }


@app.get("/api/courses/semesters", response_model=list[CourseSemesterInfo])
def get_course_semesters(verify_ssl: bool = DEFAULT_VERIFY_SSL) -> list[CourseSemesterInfo]:
    try:
        response = requests.get(
            SEMESTERS_INFO_URL,
            headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"},
            timeout=30,
            verify=verify_ssl,
        )
        response.raise_for_status()
        semesters = response.json()
        if not isinstance(semesters, list):
            raise RuntimeError("課程查詢系統回傳格式不是學期清單。")
        return [
            CourseSemesterInfo(
                semester=str(item.get("Semester") or ""),
                english_label=str(item.get("EngSemester") or ""),
                current=bool(item.get("CurrentSemester")),
            )
            for item in semesters
            if item.get("Semester")
        ]
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"課程查詢系統請求失敗：{exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/courses/search", response_model=list[CourseSearchResult])
def search_courses(
    semester: str,
    q: str = Query(min_length=1),
    mode: str = "name",
    refresh: bool = False,
    verify_ssl: bool = DEFAULT_VERIFY_SSL,
) -> list[CourseSearchResult]:
    try:
        if mode not in {"name", "code"}:
            raise RuntimeError("mode 只能是 name 或 code。")
        courses = fetch_query_courses_filtered(
            semester,
            course_no=q.strip() if mode == "code" else "",
            course_name=q.strip() if mode == "name" else "",
            verify_ssl=verify_ssl,
        )
        normalized_query = _normalize_course_lookup_text(q)
        filtered = []
        for course in courses:
            course_no = str(course.get("CourseNo") or "")
            course_name = str(course.get("CourseName") or "")
            if mode == "name" and _normalize_course_lookup_text(course_name) != normalized_query:
                continue
            if mode == "code" and normalized_query not in course_no.lower():
                continue
            filtered.append(_course_search_result(course))
        return _merge_course_search_results(filtered)
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"課程查詢系統請求失敗：{exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/planner/import-requirements/pdf", response_model=RequirementPdfImportResponse)
async def import_requirements_pdf(file: UploadFile = File(...)) -> RequirementPdfImportResponse:
    if file.content_type not in {None, "", "application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="請上傳 PDF 檔案。")
    try:
        pdf_bytes = await file.read()
        if not pdf_bytes:
            raise RuntimeError("PDF 檔案是空的。")
        payload = parse_requirement_pdf(pdf_bytes, file.filename or "requirements.pdf")
        return RequirementPdfImportResponse.model_validate(payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
        selected_count=_as_int(course.get("ChooseStudent")),
        capacity=_as_int(course.get("Restrict2")),
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


@app.get("/api/tr-rooms/status", response_model=TRRoomStatusResponse)
def get_tr_room_status(
    room: str | None = None,
    semester: str | None = None,
    node: str | None = None,
    target: str = "current",
    refresh: bool = False,
    verify_ssl: bool = DEFAULT_VERIFY_SSL,
) -> TRRoomStatusResponse:
    try:
        query_time = now().replace(microsecond=0)
        selected_semester = semester or fetch_current_query_semester(verify_ssl=verify_ssl)
        courses = fetch_query_courses(selected_semester, refresh=refresh, verify_ssl=verify_ssl)
        meetings = build_tr_meetings(courses)
        normalized_target = target.lower()
        if normalized_target not in {"current", "next"}:
            raise RuntimeError("target 只能是 current 或 next。")
        selected_node = node.upper() if node else (
            next_node_from_datetime(query_time) if normalized_target == "next" else node_from_datetime(query_time)
        )
        occupied = occupied_meetings(meetings, selected_node)
        rooms = sorted({meeting.room for meeting in meetings}, key=room_sort_key)
        busy_rooms = [room_code for room_code in rooms if room_code in occupied]
        free_rooms = [room_code for room_code in rooms if room_code not in occupied]

        requested_room = normalize_room_code(room)
        room_meetings = occupied.get(requested_room, []) if requested_room else []
        return TRRoomStatusResponse(
            semester=selected_semester,
            queried_at=query_time,
            target=normalized_target,
            node=selected_node,
            node_label=label_for_node(selected_node, query_time),
            is_class_time=selected_node is not None,
            room=requested_room,
            room_is_free=None if requested_room is None else not room_meetings,
            room_meetings=room_meetings,
            free_rooms=free_rooms,
            busy_rooms=busy_rooms,
            total_rooms=len(rooms),
            note="結果只代表正式課表，不包含臨時借用、活動或現場使用狀態。",
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"課程查詢系統請求失敗：{exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/schedule/sync", response_model=SyncResponse)
def sync_schedule(request: SyncRequest) -> SyncResponse:
    try:
        payload = fetch_schedule(request.username, request.password, request.verify_ssl)
        synced_at = now().isoformat()
        response_payload = {
            **payload,
            "profile_key": request.profile_key or request.username,
            "school_account": request.username,
            "student_name": None,
            "synced_at": synced_at,
            "course_count": len(payload["courses"]),
            "scheduled_slot_count": len(payload["slots"]),
            "schedule_entry_count": len(payload["schedule_entries"]),
            "persisted_to_supabase": False,
        }
        if request.persist_to_supabase:
            response_payload["persisted_to_supabase"] = persist_snapshot(
                profile_key=response_payload["profile_key"],
                school_account=request.username,
                payload=response_payload,
            )
        return SyncResponse.model_validate(response_payload)
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"課表系統請求失敗：{exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/schedule/{profile_key}", response_model=SyncResponse)
def get_latest_schedule(profile_key: str) -> SyncResponse:
    try:
        payload = load_snapshot(profile_key)
        if payload is None:
            raise HTTPException(status_code=404, detail="Supabase 找不到此 profile 的課表快照。")
        payload = ensure_schedule_entry_slot_times(payload)
        return SyncResponse.model_validate(payload)
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/history/import", response_model=HistoryImportResponse)
def import_history(request: HistoryImportRequest) -> HistoryImportResponse:
    try:
        payload = fetch_history_records(request.username, request.password, request.verify_ssl)
        response_payload = {
            **payload,
            "profile_key": request.profile_key or request.username,
            "school_account": request.username,
            "imported_at": now().isoformat(),
            "record_count": len(payload["records"]),
            "persisted_to_supabase": False,
        }
        if request.persist_to_supabase:
            response_payload["persisted_to_supabase"] = persist_history_snapshot(
                profile_key=response_payload["profile_key"],
                school_account=request.username,
                payload=response_payload,
            )
        return HistoryImportResponse.model_validate(response_payload)
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"歷史修課系統請求失敗：{exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/history/{profile_key}", response_model=HistoryImportResponse)
def get_latest_history(profile_key: str) -> HistoryImportResponse:
    try:
        payload = load_history_snapshot(profile_key)
        if payload is None:
            raise HTTPException(status_code=404, detail="Supabase 找不到此 profile 的歷史修課紀錄。")
        return HistoryImportResponse.model_validate(payload)
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/moodle/assignments/sync", response_model=MoodleAssignmentsResponse)
def sync_moodle_assignments(request: MoodleAssignmentsRequest) -> MoodleAssignmentsResponse:
    try:
        payload = fetch_moodle_assignments(request.username, request.password, request.verify_ssl)
        response_payload = {
            **payload,
            "profile_key": request.profile_key or request.username,
            "school_account": request.username,
            "synced_at": now().isoformat(),
            "item_count": len(payload["items"]),
            "persisted_to_supabase": False,
        }
        if request.persist_to_supabase:
            response_payload["persisted_to_supabase"] = persist_moodle_assignments_snapshot(
                profile_key=response_payload["profile_key"],
                school_account=request.username,
                payload=response_payload,
            )
        return MoodleAssignmentsResponse.model_validate(response_payload)
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Moodle 待繳事項請求失敗：{exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/moodle/assignments/{profile_key}", response_model=MoodleAssignmentsResponse)
def get_latest_moodle_assignments(profile_key: str) -> MoodleAssignmentsResponse:
    try:
        payload = load_moodle_assignments_snapshot(profile_key)
        if payload is None:
            raise HTTPException(status_code=404, detail="Supabase 找不到此 profile 的待繳事項快照。")
        return MoodleAssignmentsResponse.model_validate(payload)
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
