from __future__ import annotations

from collections.abc import Callable
from typing import Any

import requests
from fastapi import APIRouter, Header, HTTPException

try:
    from ..integrations.gpa import fetch_course_gpa
    from ..schemas.official_selection import (
        OfficialSelectionCourseActionRequest,
        OfficialSelectionKeepAliveRequest,
        OfficialSelectionPriorityUpdateRequest,
        OfficialSelectionSyncRequest,
        OfficialSelectionSyncResponse,
    )
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from integrations.gpa import fetch_course_gpa
    from schemas.official_selection import (
        OfficialSelectionCourseActionRequest,
        OfficialSelectionKeepAliveRequest,
        OfficialSelectionPriorityUpdateRequest,
        OfficialSelectionSyncRequest,
        OfficialSelectionSyncResponse,
    )


UserContextResolver = Callable[[str | None], tuple[str, str] | None]
ClientFactory = Callable[[str], Any]
SessionReuseHandler = Callable[[Any, str, tuple[str, str] | None, bool], bool]
SessionEnsureHandler = Callable[[str, str, str | None, str | None, bool], Any]
SessionPersistHandler = Callable[[tuple[str, str] | None, str, Any], None]
SessionDeleteHandler = Callable[[tuple[str, str] | None, str | None], None]
PasswordResolver = Callable[[str, str | None, str | None], str | None]
SavedCredentialsReader = Callable[[str, str | None], tuple[str, str] | None]
ConfirmationValidator = Callable[[bool], None]
NowISO = Callable[[], str]


def create_official_selection_router(
    get_client: ClientFactory,
    optional_authorization_context: UserContextResolver,
    reuse_official_session: SessionReuseHandler,
    ensure_official_session: SessionEnsureHandler,
    persist_official_session: SessionPersistHandler,
    delete_official_session: SessionDeleteHandler,
    resolve_official_password: PasswordResolver,
    read_saved_credentials: SavedCredentialsReader,
    require_confirmation: ConfirmationValidator,
    now_iso: NowISO,
) -> APIRouter:
    router = APIRouter(prefix="/api/official-selection/a02", tags=["official-selection"])

    @router.post("/sync", response_model=OfficialSelectionSyncResponse)
    def sync_initial_selection_workspace(
        request: OfficialSelectionSyncRequest,
        authorization: str | None = Header(default=None),
        gpa_api_key: str | None = Header(default=None, alias="X-GPA-API-Key"),
    ) -> OfficialSelectionSyncResponse:
        try:
            profile_key = request.profile_key or request.username
            context = optional_authorization_context(authorization)
            client = get_client(profile_key)
            if reuse_official_session(client, request.username, context, request.verify_ssl):
                payload = client.fetch_current_a02_workspace(request.verify_ssl)
            else:
                password = resolve_official_password(request.username, request.password, authorization)
                if not password:
                    raise HTTPException(status_code=400, detail="請輸入校務密碼，或先保存校務帳密後再同步官方初選。")
                payload = client.fetch_a02_workspace(request.username, password, request.verify_ssl)
                persist_official_session(context, request.username, client)
            _attach_gpa_to_payload(payload, gpa_api_key, request.verify_ssl)
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

    @router.post("/keep-alive")
    def keep_initial_selection_session_alive(
        request: OfficialSelectionKeepAliveRequest,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        try:
            profile_key = request.profile_key or request.username
            context = optional_authorization_context(authorization)
            client = get_client(profile_key)
            session_valid = reuse_official_session(client, request.username, context, request.verify_ssl)
            if not session_valid:
                saved_credentials = read_saved_credentials(request.username, authorization)
                if saved_credentials:
                    client.ensure_session(request.username, saved_credentials[1], request.verify_ssl)
                    session_valid = True
                    persist_official_session(context, request.username, client)
                else:
                    delete_official_session(context, request.username)
            return {
                "profile_key": profile_key,
                "school_account": request.username,
                "session_valid": session_valid,
                "checked_at": now_iso(),
            }
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"官方選課系統 keep-alive 失敗：{exc}") from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/join", response_model=OfficialSelectionSyncResponse)
    def join_initial_selection_course(
        request: OfficialSelectionCourseActionRequest,
        authorization: str | None = Header(default=None),
        gpa_api_key: str | None = Header(default=None, alias="X-GPA-API-Key"),
    ) -> OfficialSelectionSyncResponse:
        return _run_confirmed_course_action(
            request,
            authorization,
            gpa_api_key,
            require_confirmation,
            ensure_official_session,
            optional_authorization_context,
            persist_official_session,
            lambda client, course_no, verify_ssl: client.join_course(course_no, verify_ssl),
        )

    @router.post("/add-to-waitlist", response_model=OfficialSelectionSyncResponse)
    def add_initial_selection_waitlist_course(
        request: OfficialSelectionCourseActionRequest,
        authorization: str | None = Header(default=None),
        gpa_api_key: str | None = Header(default=None, alias="X-GPA-API-Key"),
    ) -> OfficialSelectionSyncResponse:
        return _run_confirmed_course_action(
            request,
            authorization,
            gpa_api_key,
            require_confirmation,
            ensure_official_session,
            optional_authorization_context,
            persist_official_session,
            lambda client, course_no, verify_ssl: client.add_course_to_waitlist(course_no, verify_ssl),
        )

    @router.post("/remove", response_model=OfficialSelectionSyncResponse)
    def remove_initial_selection_course(
        request: OfficialSelectionCourseActionRequest,
        authorization: str | None = Header(default=None),
        gpa_api_key: str | None = Header(default=None, alias="X-GPA-API-Key"),
    ) -> OfficialSelectionSyncResponse:
        return _run_confirmed_course_action(
            request,
            authorization,
            gpa_api_key,
            require_confirmation,
            ensure_official_session,
            optional_authorization_context,
            persist_official_session,
            lambda client, course_no, verify_ssl: client.remove_course(course_no, verify_ssl),
        )

    @router.post("/reorder", response_model=OfficialSelectionSyncResponse)
    def reorder_initial_selection_courses(
        request: OfficialSelectionPriorityUpdateRequest,
        authorization: str | None = Header(default=None),
        gpa_api_key: str | None = Header(default=None, alias="X-GPA-API-Key"),
    ) -> OfficialSelectionSyncResponse:
        try:
            require_confirmation(request.confirmed)
            profile_key = request.profile_key or request.username
            context = optional_authorization_context(authorization)
            client = ensure_official_session(profile_key, request.username, request.password, authorization, request.verify_ssl)
            payload = client.reorder_registered_courses(request.ordered_course_nos, request.verify_ssl)
            persist_official_session(context, request.username, client)
            _attach_gpa_to_payload(payload, gpa_api_key, request.verify_ssl)
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

    return router


CourseActionRunner = Callable[[Any, str, bool], dict[str, Any]]


def _run_confirmed_course_action(
    request: OfficialSelectionCourseActionRequest,
    authorization: str | None,
    gpa_api_key: str | None,
    require_confirmation: ConfirmationValidator,
    ensure_official_session: SessionEnsureHandler,
    optional_authorization_context: UserContextResolver,
    persist_official_session: SessionPersistHandler,
    run_action: CourseActionRunner,
) -> OfficialSelectionSyncResponse:
    try:
        require_confirmation(request.confirmed)
        profile_key = request.profile_key or request.username
        context = optional_authorization_context(authorization)
        client = ensure_official_session(profile_key, request.username, request.password, authorization, request.verify_ssl)
        payload = run_action(client, request.course_no, request.verify_ssl)
        persist_official_session(context, request.username, client)
        _attach_gpa_to_payload(payload, gpa_api_key, request.verify_ssl)
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


def _attach_gpa_to_payload(payload: dict[str, Any], api_key: str | None, verify_ssl: bool) -> None:
    token = (api_key or "").strip()
    if not token:
        return

    cache: dict[str, tuple[float | None, str]] = {}
    for list_key in ("registered_courses", "available_courses", "required_preset_courses"):
        courses = payload.get(list_key)
        if not isinstance(courses, list):
            continue
        for course in courses:
            if not isinstance(course, dict):
                continue
            course_no = str(course.get("course_no") or "").strip().upper()
            if not course_no:
                continue
            if course_no not in cache:
                cache[course_no] = fetch_course_gpa(course_no, token, verify_ssl)
            course["gpa"], course["gpa_status"] = cache[course_no]
