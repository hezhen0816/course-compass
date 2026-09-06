from __future__ import annotations

from collections.abc import Callable
from typing import Any

import requests
from fastapi import APIRouter, Header, HTTPException

try:
    from ..models import (
        OfficialSelectionCourseActionRequest,
        OfficialSelectionKeepAliveRequest,
        OfficialSelectionPriorityUpdateRequest,
        OfficialSelectionSyncRequest,
        OfficialSelectionSyncResponse,
    )
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from models import (
        OfficialSelectionCourseActionRequest,
        OfficialSelectionKeepAliveRequest,
        OfficialSelectionPriorityUpdateRequest,
        OfficialSelectionSyncRequest,
        OfficialSelectionSyncResponse,
    )


UserContext = tuple[str, str]
UserContextResolver = Callable[[str | None], UserContext]
AccountOwnershipValidator = Callable[[UserContext, str], None]
ClientKeyBuilder = Callable[[UserContext, str], str]
ClientFactory = Callable[[str], Any]
SessionReuseHandler = Callable[[Any, str, UserContext | None, bool], bool]
SessionEnsureHandler = Callable[[str, str, str | None, str | None, bool], Any]
SessionPersistHandler = Callable[[UserContext | None, str, Any], None]
SessionDeleteHandler = Callable[[UserContext | None, str | None], None]
PasswordResolver = Callable[[str, str | None, str | None], str | None]
SavedCredentialsReader = Callable[[str, str | None], tuple[str, str] | None]
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
    assert_account_ownership: AccountOwnershipValidator,
    build_client_key: ClientKeyBuilder,
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

    def _authorize(request: _AnyOfficialRequest, authorization: str | None) -> tuple[UserContext, str, str]:
        """Resolve the cloud user, bind the school account, and pick the client cache key.

        Official-selection clients hold a logged-in school session, so they are
        cached per cloud user + school account rather than per caller-supplied
        profile_key; otherwise anyone naming a student ID could reuse that session.
        """
        context = require_user_context(authorization)
        username = request.username.strip()
        assert_account_ownership(context, username)
        requested = (request.profile_key or "").strip()
        if requested and requested.casefold() != username.casefold():
            raise HTTPException(status_code=400, detail="profile_key 必須與校務帳號相同。")
        return context, username, build_client_key(context, username)

    @router.post("/sync", response_model=OfficialSelectionSyncResponse)
    def sync_initial_selection_workspace(
        request: OfficialSelectionSyncRequest,
        authorization: str | None = Header(default=None),
    ) -> OfficialSelectionSyncResponse:
        context, username, client_key = _authorize(request, authorization)
        try:
            client = get_client(client_key)
            if reuse_official_session(client, username, context, request.verify_ssl):
                payload = client.fetch_current_a02_workspace(request.verify_ssl)
            else:
                password = resolve_official_password(username, request.password, authorization)
                if not password:
                    raise HTTPException(status_code=400, detail="請輸入校務密碼，或先保存校務帳密後再同步官方初選。")
                payload = client.fetch_a02_workspace(username, password, request.verify_ssl)
                persist_official_session(context, username, client)
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
        context, username, client_key = _authorize(request, authorization)
        try:
            client = get_client(client_key)
            session_valid = reuse_official_session(client, username, context, request.verify_ssl)
            if not session_valid:
                saved_credentials = read_saved_credentials(username, authorization)
                if saved_credentials:
                    client.ensure_session(username, saved_credentials[1], request.verify_ssl)
                    session_valid = True
                    persist_official_session(context, username, client)
                else:
                    delete_official_session(context, username)
            return {
                "profile_key": username,
                "school_account": username,
                "session_valid": session_valid,
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
        context, username, client_key = _authorize(request, authorization)
        try:
            client = ensure_official_session(client_key, username, request.password, authorization, request.verify_ssl)
            payload = run_action(client, request.course_no, request.verify_ssl)
            persist_official_session(context, username, client)
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
            lambda client, course_no, verify_ssl: client.add_course_to_waitlist(course_no, verify_ssl),
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
        context, username, client_key = _authorize(request, authorization)
        try:
            client = ensure_official_session(client_key, username, request.password, authorization, request.verify_ssl)
            payload = client.reorder_registered_courses(request.ordered_course_nos, request.verify_ssl)
            persist_official_session(context, username, client)
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
