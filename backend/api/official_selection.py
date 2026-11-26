from __future__ import annotations

from collections.abc import Callable
from typing import Any

import requests
from fastapi import APIRouter, Header, HTTPException

try:
    from ..config import DEFAULT_VERIFY_SSL
    from ..models import (
        OfficialSelectionCourseActionRequest,
        OfficialSelectionKeepAliveRequest,
        OfficialSelectionPriorityUpdateRequest,
        OfficialSelectionSyncRequest,
        OfficialSelectionSyncResponse,
    )
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from config import DEFAULT_VERIFY_SSL
    from models import (
        OfficialSelectionCourseActionRequest,
        OfficialSelectionKeepAliveRequest,
        OfficialSelectionPriorityUpdateRequest,
        OfficialSelectionSyncRequest,
        OfficialSelectionSyncResponse,
    )


UserContext = tuple[str, str]
UserContextResolver = Callable[[str | None], UserContext]
ClientKeyBuilder = Callable[[UserContext, str], str]
ClientFactory = Callable[[str], Any]
ConfirmationValidator = Callable[[bool], None]
NowISO = Callable[[], str]

_AnyOfficialRequest = (
    OfficialSelectionSyncRequest
    | OfficialSelectionKeepAliveRequest
    | OfficialSelectionCourseActionRequest
    | OfficialSelectionPriorityUpdateRequest
)


def create_official_selection_router(
    get_client: ClientFactory,
    require_user_context: UserContextResolver,
    build_client_key: ClientKeyBuilder,
    require_confirmation: ConfirmationValidator,
    now_iso: NowISO,
) -> APIRouter:
    router = APIRouter(prefix="/api/official-selection/a02", tags=["official-selection"])

    def _authorize(request: _AnyOfficialRequest, authorization: str | None) -> tuple[str, str]:
        """Resolve the cloud user and pick the account-specific client cache key.

        Official-selection clients hold a logged-in school session, so they are
        cached per cloud user + school account rather than per caller-supplied
        profile_key; otherwise anyone naming a student ID could reuse that session.
        """
        context = require_user_context(authorization)
        username = request.username.strip()
        requested = (request.profile_key or "").strip()
        if requested and requested.casefold() != username.casefold():
            raise HTTPException(status_code=400, detail="profile_key 必須與校務帳號相同。")
        return username, build_client_key(context, username)

    def _session_is_valid(client: Any) -> bool:
        try:
            return client.keep_alive(DEFAULT_VERIFY_SSL)
        except (RuntimeError, requests.RequestException):
            return False

    def _action_client(client_key: str, username: str, password: str | None) -> Any:
        client = get_client(client_key)
        if not _session_is_valid(client):
            if not password:
                raise HTTPException(status_code=400, detail="校務連線已過期，請重新同步官方初選。")
            client.ensure_session(username, password, DEFAULT_VERIFY_SSL)
        return client

    @router.post("/sync", response_model=OfficialSelectionSyncResponse)
    def sync_initial_selection_workspace(
        request: OfficialSelectionSyncRequest,
        authorization: str | None = Header(default=None),
    ) -> OfficialSelectionSyncResponse:
        username, client_key = _authorize(request, authorization)
        try:
            client = get_client(client_key)
            if _session_is_valid(client):
                payload = client.fetch_current_a02_workspace(DEFAULT_VERIFY_SSL)
            else:
                password = request.password
                if not password:
                    raise HTTPException(status_code=400, detail="請輸入校務密碼以同步官方初選。")
                payload = client.fetch_a02_workspace(username, password, DEFAULT_VERIFY_SSL)
            return OfficialSelectionSyncResponse.model_validate(
                {
                    **payload,
                    "profile_key": username,
                    "school_account": username,
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
        username, client_key = _authorize(request, authorization)
        try:
            client = get_client(client_key)
            return {
                "profile_key": username,
                "school_account": username,
                "session_valid": _session_is_valid(client),
                "checked_at": now_iso(),
            }
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"官方選課系統 keep-alive 失敗：{exc}") from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    def _run_confirmed_course_action(
        request: OfficialSelectionCourseActionRequest,
        authorization: str | None,
        run_action: CourseActionRunner,
    ) -> OfficialSelectionSyncResponse:
        require_confirmation(request.confirmed)
        username, client_key = _authorize(request, authorization)
        try:
            client = _action_client(client_key, username, request.password)
            payload = run_action(client, request.course_no, DEFAULT_VERIFY_SSL)
            return OfficialSelectionSyncResponse.model_validate(
                {
                    **payload,
                    "profile_key": username,
                    "school_account": username,
                }
            )
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"官方選課系統請求失敗：{exc}") from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/join", response_model=OfficialSelectionSyncResponse)
    def join_initial_selection_course(
        request: OfficialSelectionCourseActionRequest,
        authorization: str | None = Header(default=None),
    ) -> OfficialSelectionSyncResponse:
        return _run_confirmed_course_action(
            request,
            authorization,
            lambda client, course_no, verify_ssl: client.join_course(course_no, verify_ssl),
        )

    @router.post("/add-to-waitlist", response_model=OfficialSelectionSyncResponse)
    def add_initial_selection_waitlist_course(
        request: OfficialSelectionCourseActionRequest,
        authorization: str | None = Header(default=None),
    ) -> OfficialSelectionSyncResponse:
        return _run_confirmed_course_action(
            request,
            authorization,
            lambda client, course_no, verify_ssl: client.add_course_to_waitlist(course_no, verify_ssl, request.period),
        )

    @router.post("/remove", response_model=OfficialSelectionSyncResponse)
    def remove_initial_selection_course(
        request: OfficialSelectionCourseActionRequest,
        authorization: str | None = Header(default=None),
    ) -> OfficialSelectionSyncResponse:
        return _run_confirmed_course_action(
            request,
            authorization,
            lambda client, course_no, verify_ssl: client.remove_course(course_no, verify_ssl),
        )

    @router.post("/reorder", response_model=OfficialSelectionSyncResponse)
    def reorder_initial_selection_courses(
        request: OfficialSelectionPriorityUpdateRequest,
        authorization: str | None = Header(default=None),
    ) -> OfficialSelectionSyncResponse:
        require_confirmation(request.confirmed)
        username, client_key = _authorize(request, authorization)
        try:
            client = _action_client(client_key, username, request.password)
            payload = client.reorder_registered_courses(request.ordered_course_nos, DEFAULT_VERIFY_SSL)
            return OfficialSelectionSyncResponse.model_validate(
                {
                    **payload,
                    "profile_key": username,
                    "school_account": username,
                }
            )
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"官方選課系統請求失敗：{exc}") from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return router


CourseActionRunner = Callable[[Any, str, bool], dict[str, Any]]
