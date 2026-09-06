from __future__ import annotations

from collections.abc import Callable
from typing import Any

import requests
from fastapi import APIRouter, Header, HTTPException

try:
    from ..config import DEFAULT_VERIFY_SSL
    from ..models import (
        HistoryImportRequest,
        HistoryImportResponse,
        MoodleAssignmentsRequest,
        MoodleAssignmentsResponse,
        SyncRequest,
        SyncResponse,
    )
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from config import DEFAULT_VERIFY_SSL
    from models import (
        HistoryImportRequest,
        HistoryImportResponse,
        MoodleAssignmentsRequest,
        MoodleAssignmentsResponse,
        SyncRequest,
        SyncResponse,
    )


UserContext = tuple[str, str]
UserContextResolver = Callable[[str | None], UserContext]
AccountOwnershipValidator = Callable[[UserContext, str], None]
ProfileOwnershipValidator = Callable[[UserContext, str], None]
PasswordResolver = Callable[[str, str | None, str | None], str]
ScheduleFetcher = Callable[[str, str, bool], dict[str, Any]]
HistoryFetcher = Callable[[str, str, bool], dict[str, Any]]
MoodleFetcher = Callable[[str, str, bool], dict[str, Any]]
SnapshotLoader = Callable[[str], dict[str, Any] | None]
SnapshotPersister = Callable[[str, str, dict[str, Any]], bool]
SchedulePayloadNormalizer = Callable[[dict[str, Any]], dict[str, Any]]
NowISO = Callable[[], str]


def _profile_key_for(username: str, requested_profile_key: str | None) -> str:
    """Snapshots are always keyed by the school account that produced them.

    A caller-supplied profile_key that differs from the login is refused so an
    authenticated user cannot write into another student's snapshot slot.
    """
    username = username.strip()
    requested = (requested_profile_key or "").strip()
    if requested and requested.casefold() != username.casefold():
        raise HTTPException(status_code=400, detail="profile_key 必須與校務帳號相同。")
    return username


def create_sync_router(
    require_user_context: UserContextResolver,
    assert_account_ownership: AccountOwnershipValidator,
    assert_profile_ownership: ProfileOwnershipValidator,
    resolve_password: PasswordResolver,
    fetch_schedule_payload: ScheduleFetcher,
    fetch_history_payload: HistoryFetcher,
    fetch_moodle_payload: MoodleFetcher,
    persist_schedule_snapshot: SnapshotPersister,
    persist_history_snapshot: SnapshotPersister,
    persist_moodle_snapshot: SnapshotPersister,
    load_schedule_snapshot: SnapshotLoader,
    load_history_snapshot: SnapshotLoader,
    load_moodle_snapshot: SnapshotLoader,
    normalize_schedule_payload: SchedulePayloadNormalizer,
    now_iso: NowISO,
) -> APIRouter:
    router = APIRouter()

    def _authorize_sync(request: SyncRequest | HistoryImportRequest | MoodleAssignmentsRequest, authorization: str | None) -> str:
        context = require_user_context(authorization)
        assert_account_ownership(context, request.username)
        return _profile_key_for(request.username, request.profile_key)

    def _authorize_read(profile_key: str, authorization: str | None) -> None:
        context = require_user_context(authorization)
        assert_profile_ownership(context, profile_key)

    @router.post("/api/schedule/sync", response_model=SyncResponse)
    def sync_schedule(
        request: SyncRequest,
        authorization: str | None = Header(default=None),
    ) -> SyncResponse:
        profile_key = _authorize_sync(request, authorization)
        try:
            password = resolve_password(request.username, request.password, authorization)
            payload = fetch_schedule_payload(request.username, password, DEFAULT_VERIFY_SSL)
            response_payload = {
                **payload,
                "profile_key": profile_key,
                "school_account": request.username,
                "student_name": None,
                "synced_at": now_iso(),
                "course_count": len(payload["courses"]),
                "scheduled_slot_count": len(payload["slots"]),
                "schedule_entry_count": len(payload["schedule_entries"]),
                "persisted_to_supabase": False,
            }
            if request.persist_to_supabase:
                response_payload["persisted_to_supabase"] = persist_schedule_snapshot(
                    profile_key,
                    request.username,
                    response_payload,
                )
            return SyncResponse.model_validate(response_payload)
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"課表系統請求失敗：{exc}") from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/api/schedule/{profile_key}", response_model=SyncResponse)
    def get_latest_schedule(
        profile_key: str,
        authorization: str | None = Header(default=None),
    ) -> SyncResponse:
        _authorize_read(profile_key, authorization)
        try:
            payload = load_schedule_snapshot(profile_key)
            if payload is None:
                raise HTTPException(status_code=404, detail="Supabase 找不到此 profile 的課表快照。")
            payload = normalize_schedule_payload(payload)
            return SyncResponse.model_validate(payload)
        except HTTPException:
            raise
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.post("/api/history/import", response_model=HistoryImportResponse)
    def import_history(
        request: HistoryImportRequest,
        authorization: str | None = Header(default=None),
    ) -> HistoryImportResponse:
        profile_key = _authorize_sync(request, authorization)
        try:
            password = resolve_password(request.username, request.password, authorization)
            payload = fetch_history_payload(request.username, password, DEFAULT_VERIFY_SSL)
            response_payload = {
                **payload,
                "profile_key": profile_key,
                "school_account": request.username,
                "imported_at": now_iso(),
                "record_count": len(payload["records"]),
                "persisted_to_supabase": False,
            }
            if request.persist_to_supabase:
                response_payload["persisted_to_supabase"] = persist_history_snapshot(
                    profile_key,
                    request.username,
                    response_payload,
                )
            return HistoryImportResponse.model_validate(response_payload)
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"歷史修課系統請求失敗：{exc}") from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/api/history/{profile_key}", response_model=HistoryImportResponse)
    def get_latest_history(
        profile_key: str,
        authorization: str | None = Header(default=None),
    ) -> HistoryImportResponse:
        _authorize_read(profile_key, authorization)
        try:
            payload = load_history_snapshot(profile_key)
            if payload is None:
                raise HTTPException(status_code=404, detail="Supabase 找不到此 profile 的歷史修課紀錄。")
            return HistoryImportResponse.model_validate(payload)
        except HTTPException:
            raise
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.post("/api/moodle/assignments/sync", response_model=MoodleAssignmentsResponse)
    def sync_moodle_assignments(
        request: MoodleAssignmentsRequest,
        authorization: str | None = Header(default=None),
    ) -> MoodleAssignmentsResponse:
        profile_key = _authorize_sync(request, authorization)
        try:
            password = resolve_password(request.username, request.password, authorization)
            payload = fetch_moodle_payload(request.username, password, DEFAULT_VERIFY_SSL)
            response_payload = {
                **payload,
                "profile_key": profile_key,
                "school_account": request.username,
                "synced_at": now_iso(),
                "item_count": len(payload["items"]),
                "persisted_to_supabase": False,
            }
            if request.persist_to_supabase:
                response_payload["persisted_to_supabase"] = persist_moodle_snapshot(
                    profile_key,
                    request.username,
                    response_payload,
                )
            return MoodleAssignmentsResponse.model_validate(response_payload)
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"Moodle 待繳事項請求失敗：{exc}") from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/api/moodle/assignments/{profile_key}", response_model=MoodleAssignmentsResponse)
    def get_latest_moodle_assignments(
        profile_key: str,
        authorization: str | None = Header(default=None),
    ) -> MoodleAssignmentsResponse:
        _authorize_read(profile_key, authorization)
        try:
            payload = load_moodle_snapshot(profile_key)
            if payload is None:
                raise HTTPException(status_code=404, detail="Supabase 找不到此 profile 的待繳事項快照。")
            return MoodleAssignmentsResponse.model_validate(payload)
        except HTTPException:
            raise
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return router
