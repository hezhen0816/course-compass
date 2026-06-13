from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import requests
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

try:
    from .api.courses import create_courses_router
    from .api.health import create_health_router
    from .api.planner import create_planner_router
    from .api.school_credentials import create_school_credentials_router
    from .config import DEFAULT_VERIFY_SSL
    from .credentials import (
        CredentialStoreError,
        delete_school_credentials,
        get_school_credentials_secret,
        get_school_credentials_status,
        put_school_credentials,
        resolve_user_id,
    )
    from .history import fetch_history_records
    from .models import (
        HistoryImportRequest,
        HistoryImportResponse,
        MoodleAssignmentsRequest,
        MoodleAssignmentsResponse,
        OfficialSelectionCourseActionRequest,
        OfficialSelectionKeepAliveRequest,
        OfficialSelectionPriorityUpdateRequest,
        OfficialSelectionSyncRequest,
        OfficialSelectionSyncResponse,
        SyncRequest,
        SyncResponse,
        TRRoomStatusResponse,
    )
    from .moodle import fetch_moodle_assignments
    from .official_selection import get_official_selection_client
    from .planner_pdf import parse_requirement_pdf
    from .schedule import fetch_schedule
    from .school_sessions import (
        delete_school_session,
        load_school_session_state,
        official_session_expires_at,
        save_school_session_state,
    )
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
    from api.courses import create_courses_router
    from api.health import create_health_router
    from api.planner import create_planner_router
    from api.school_credentials import create_school_credentials_router
    from config import DEFAULT_VERIFY_SSL
    from credentials import (
        CredentialStoreError,
        delete_school_credentials,
        get_school_credentials_secret,
        get_school_credentials_status,
        put_school_credentials,
        resolve_user_id,
    )
    from history import fetch_history_records
    from models import (
        HistoryImportRequest,
        HistoryImportResponse,
        MoodleAssignmentsRequest,
        MoodleAssignmentsResponse,
        OfficialSelectionCourseActionRequest,
        OfficialSelectionKeepAliveRequest,
        OfficialSelectionPriorityUpdateRequest,
        OfficialSelectionSyncRequest,
        OfficialSelectionSyncResponse,
        SyncRequest,
        SyncResponse,
        TRRoomStatusResponse,
    )
    from moodle import fetch_moodle_assignments
    from official_selection import get_official_selection_client
    from planner_pdf import parse_requirement_pdf
    from schedule import fetch_schedule
    from school_sessions import (
        delete_school_session,
        load_school_session_state,
        official_session_expires_at,
        save_school_session_state,
    )
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


API_VERSION = "0.3.0"
OFFICIAL_SELECTION_CAPABILITIES = {
    "school_credentials": True,
    "school_sessions": True,
    "official_selection": True,
    "official_selection_actions": [
        "sync",
        "keep_alive",
        "join",
        "add_to_waitlist",
        "remove",
        "reorder",
    ],
}

app = FastAPI(title="Course Compass Sync API", version=API_VERSION)
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


def _current_user_context(authorization: str | None) -> tuple[str, str]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="請先登入後再保存校務帳密。")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="請先登入後再保存校務帳密。")
    try:
        return resolve_user_id(token), token
    except CredentialStoreError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Supabase 使用者驗證失敗：{exc}") from exc


def _authorization_context(authorization: str | None) -> tuple[str, str] | None:
    if not authorization:
        return None
    return _current_user_context(authorization)


def _optional_authorization_context(authorization: str | None) -> tuple[str, str] | None:
    try:
        return _authorization_context(authorization)
    except HTTPException:
        return None


def _saved_school_credentials(
    username: str,
    authorization: str | None,
    *,
    required: bool = False,
) -> tuple[str, str] | None:
    context = _authorization_context(authorization)
    if context is None:
        if required:
            raise HTTPException(status_code=401, detail="請先登入後再使用已保存的校務帳密。")
        return None

    user_id, access_token = context
    try:
        credentials = get_school_credentials_secret(user_id, access_token)
    except CredentialStoreError as exc:
        if required:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return None
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"讀取校務帳密失敗：{exc}") from exc

    saved_username = str(credentials.get("username") or "").strip()
    password = str(credentials.get("password") or "")
    if saved_username and saved_username != username:
        raise HTTPException(status_code=403, detail="已保存的校務帳號與本次操作帳號不同。")
    if not password:
        if required:
            raise HTTPException(status_code=400, detail="尚未保存校務密碼，請先輸入帳密同步一次。")
        return None
    return saved_username or username, password


def _official_password(username: str, password: str | None, authorization: str | None) -> str | None:
    if password:
        return password
    saved_credentials = _saved_school_credentials(username, authorization)
    return saved_credentials[1] if saved_credentials else None


def _required_school_password(username: str, password: str | None, authorization: str | None) -> str:
    resolved_password = _official_password(username, password, authorization)
    if not resolved_password:
        raise HTTPException(status_code=400, detail="請輸入校務密碼，或先保存校務帳密後再同步。")
    return resolved_password


def _ensure_official_session(
    profile_key: str,
    username: str,
    password: str | None,
    authorization: str | None,
    verify_ssl: bool,
) -> Any:
    client = get_official_selection_client(profile_key)
    context = _optional_authorization_context(authorization)
    if _reuse_official_session(client, username, context, verify_ssl):
        return client

    resolved_password = _official_password(username, password, authorization)
    if resolved_password:
        client.ensure_session(username, resolved_password, verify_ssl)
        _persist_official_session(context, username, client)
    return client


def _persist_official_session(
    context: tuple[str, str] | None,
    username: str,
    client: Any,
) -> None:
    if context is None:
        return
    try:
        save_school_session_state(
            context[0],
            username,
            client.export_session_state(),
            expires_at=official_session_expires_at(),
            last_keep_alive_at=datetime.now(timezone.utc),
        )
    except (CredentialStoreError, requests.RequestException, AttributeError, TypeError, ValueError):
        return


def _delete_official_session(context: tuple[str, str] | None, username: str | None = None) -> None:
    if context is None:
        return
    try:
        delete_school_session(context[0], username)
    except (CredentialStoreError, requests.RequestException):
        return


def _reuse_official_session(
    client: Any,
    username: str,
    context: tuple[str, str] | None,
    verify_ssl: bool,
) -> bool:
    try:
        if client.keep_alive(verify_ssl):
            _persist_official_session(context, username, client)
            return True
    except (RuntimeError, requests.RequestException, AttributeError):
        pass

    if context is None:
        return False

    try:
        saved_session = load_school_session_state(context[0], username)
    except (CredentialStoreError, requests.RequestException):
        return False
    if not saved_session:
        return False

    try:
        if not client.restore_session_state(saved_session["session_state"]):
            _delete_official_session(context, username)
            return False
        if client.keep_alive(verify_ssl):
            _persist_official_session(context, username, client)
            return True
    except (RuntimeError, requests.RequestException, AttributeError, KeyError, TypeError):
        pass

    _delete_official_session(context, username)
    return False


def _require_official_action_confirmation(confirmed: bool) -> None:
    if not confirmed:
        raise HTTPException(status_code=400, detail="官方選課操作需要使用者明確確認後才能送出。")


app.include_router(create_health_router(API_VERSION, OFFICIAL_SELECTION_CAPABILITIES))
app.include_router(
    create_courses_router(
        lambda semester, course_no, course_name, verify_ssl: fetch_query_courses_filtered(
            semester,
            course_no=course_no,
            course_name=course_name,
            verify_ssl=verify_ssl,
        )
    )
)
app.include_router(create_planner_router(lambda pdf_bytes, filename: parse_requirement_pdf(pdf_bytes, filename)))
app.include_router(
    create_school_credentials_router(
        lambda authorization: _current_user_context(authorization),
        lambda context, username: _delete_official_session(context, username),
        lambda user_id, access_token: get_school_credentials_status(user_id, access_token),
        lambda user_id, username, password, access_token: put_school_credentials(
            user_id,
            username,
            password,
            access_token,
        ),
        lambda user_id, access_token: delete_school_credentials(user_id, access_token),
    )
)


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
def sync_schedule(
    request: SyncRequest,
    authorization: str | None = Header(default=None),
) -> SyncResponse:
    try:
        password = _required_school_password(request.username, request.password, authorization)
        payload = fetch_schedule(request.username, password, request.verify_ssl)
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
def import_history(
    request: HistoryImportRequest,
    authorization: str | None = Header(default=None),
) -> HistoryImportResponse:
    try:
        password = _required_school_password(request.username, request.password, authorization)
        payload = fetch_history_records(request.username, password, request.verify_ssl)
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
def sync_moodle_assignments(
    request: MoodleAssignmentsRequest,
    authorization: str | None = Header(default=None),
) -> MoodleAssignmentsResponse:
    try:
        password = _required_school_password(request.username, request.password, authorization)
        payload = fetch_moodle_assignments(request.username, password, request.verify_ssl)
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


@app.post("/api/official-selection/a02/sync", response_model=OfficialSelectionSyncResponse)
def sync_initial_selection_workspace(
    request: OfficialSelectionSyncRequest,
    authorization: str | None = Header(default=None),
) -> OfficialSelectionSyncResponse:
    try:
        profile_key = request.profile_key or request.username
        context = _optional_authorization_context(authorization)
        client = get_official_selection_client(profile_key)
        if _reuse_official_session(client, request.username, context, request.verify_ssl):
            payload = client.fetch_current_a02_workspace(request.verify_ssl)
        else:
            password = _official_password(request.username, request.password, authorization)
            if not password:
                raise HTTPException(status_code=400, detail="請輸入校務密碼，或先保存校務帳密後再同步官方初選。")
            payload = client.fetch_a02_workspace(request.username, password, request.verify_ssl)
            _persist_official_session(context, request.username, client)
        return OfficialSelectionSyncResponse.model_validate(
            {
                **payload,
                "profile_key": profile_key,
                "school_account": request.username,
            }
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"官方選課系統請求失敗：{exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/official-selection/a02/keep-alive")
def keep_initial_selection_session_alive(
    request: OfficialSelectionKeepAliveRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    try:
        profile_key = request.profile_key or request.username
        context = _optional_authorization_context(authorization)
        client = get_official_selection_client(profile_key)
        session_valid = _reuse_official_session(client, request.username, context, request.verify_ssl)
        if not session_valid:
            saved_credentials = _saved_school_credentials(request.username, authorization)
            if saved_credentials:
                client.ensure_session(request.username, saved_credentials[1], request.verify_ssl)
                session_valid = True
                _persist_official_session(context, request.username, client)
            else:
                _delete_official_session(context, request.username)
        return {
            "profile_key": profile_key,
            "school_account": request.username,
            "session_valid": session_valid,
            "checked_at": now().isoformat(),
        }
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"官方選課系統 keep-alive 失敗：{exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/official-selection/a02/join", response_model=OfficialSelectionSyncResponse)
def join_initial_selection_course(
    request: OfficialSelectionCourseActionRequest,
    authorization: str | None = Header(default=None),
) -> OfficialSelectionSyncResponse:
    try:
        _require_official_action_confirmation(request.confirmed)
        profile_key = request.profile_key or request.username
        context = _optional_authorization_context(authorization)
        client = _ensure_official_session(profile_key, request.username, request.password, authorization, request.verify_ssl)
        payload = client.join_course(request.course_no, request.verify_ssl)
        _persist_official_session(context, request.username, client)
        return OfficialSelectionSyncResponse.model_validate(
            {
                **payload,
                "profile_key": profile_key,
                "school_account": request.username,
            }
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"官方選課系統請求失敗：{exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/official-selection/a02/add-to-waitlist", response_model=OfficialSelectionSyncResponse)
def add_initial_selection_waitlist_course(
    request: OfficialSelectionCourseActionRequest,
    authorization: str | None = Header(default=None),
) -> OfficialSelectionSyncResponse:
    try:
        _require_official_action_confirmation(request.confirmed)
        profile_key = request.profile_key or request.username
        context = _optional_authorization_context(authorization)
        client = _ensure_official_session(profile_key, request.username, request.password, authorization, request.verify_ssl)
        payload = client.add_course_to_waitlist(request.course_no, request.verify_ssl)
        _persist_official_session(context, request.username, client)
        return OfficialSelectionSyncResponse.model_validate(
            {
                **payload,
                "profile_key": profile_key,
                "school_account": request.username,
            }
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"官方選課系統請求失敗：{exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/official-selection/a02/remove", response_model=OfficialSelectionSyncResponse)
def remove_initial_selection_course(
    request: OfficialSelectionCourseActionRequest,
    authorization: str | None = Header(default=None),
) -> OfficialSelectionSyncResponse:
    try:
        _require_official_action_confirmation(request.confirmed)
        profile_key = request.profile_key or request.username
        context = _optional_authorization_context(authorization)
        client = _ensure_official_session(profile_key, request.username, request.password, authorization, request.verify_ssl)
        payload = client.remove_course(request.course_no, request.verify_ssl)
        _persist_official_session(context, request.username, client)
        return OfficialSelectionSyncResponse.model_validate(
            {
                **payload,
                "profile_key": profile_key,
                "school_account": request.username,
            }
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"官方選課系統請求失敗：{exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/official-selection/a02/reorder", response_model=OfficialSelectionSyncResponse)
def reorder_initial_selection_courses(
    request: OfficialSelectionPriorityUpdateRequest,
    authorization: str | None = Header(default=None),
) -> OfficialSelectionSyncResponse:
    try:
        _require_official_action_confirmation(request.confirmed)
        profile_key = request.profile_key or request.username
        context = _optional_authorization_context(authorization)
        client = _ensure_official_session(profile_key, request.username, request.password, authorization, request.verify_ssl)
        payload = client.reorder_registered_courses(request.ordered_course_nos, request.verify_ssl)
        _persist_official_session(context, request.username, client)
        return OfficialSelectionSyncResponse.model_validate(
            {
                **payload,
                "profile_key": profile_key,
                "school_account": request.username,
            }
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"官方選課系統請求失敗：{exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
