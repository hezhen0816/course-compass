from __future__ import annotations

from collections.abc import Callable
from typing import Any

import requests
from fastapi import APIRouter, Header, HTTPException

try:
    from ..schemas.models import (
        HistoryImportRequest,
        HistoryImportResponse,
        MoodleAssignmentsRequest,
        MoodleAssignmentsResponse,
        SyncRequest,
        SyncResponse,
    )
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from schemas.models import (
        HistoryImportRequest,
        HistoryImportResponse,
        MoodleAssignmentsRequest,
        MoodleAssignmentsResponse,
        SyncRequest,
        SyncResponse,
    )


PasswordResolver = Callable[[str, str | None, str | None], str]
ScheduleFetcher = Callable[[str, str, bool], dict[str, Any]]
HistoryFetcher = Callable[[str, str, bool], dict[str, Any]]
MoodleFetcher = Callable[[str, str, bool], dict[str, Any]]
SnapshotLoader = Callable[[str], dict[str, Any] | None]
SnapshotPersister = Callable[[str, str, dict[str, Any]], bool]
SchedulePayloadNormalizer = Callable[[dict[str, Any]], dict[str, Any]]
NowISO = Callable[[], str]


def create_sync_router(
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

    @router.post("/api/schedule/sync", response_model=SyncResponse)
    def sync_schedule(
        request: SyncRequest,
        authorization: str | None = Header(default=None),
    ) -> SyncResponse:
        try:
            password = resolve_password(request.username, request.password, authorization)
            payload = fetch_schedule_payload(request.username, password, request.verify_ssl)
            response_payload = {
                **payload,
                "profile_key": request.profile_key or request.username,
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
                    response_payload["profile_key"],
                    request.username,
                    response_payload,
                )
            return SyncResponse.model_validate(response_payload)
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"課表系統請求失敗：{exc}") from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/api/schedule/{profile_key}", response_model=SyncResponse)
    def get_latest_schedule(profile_key: str) -> SyncResponse:
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
        try:
            password = resolve_password(request.username, request.password, authorization)
            payload = fetch_history_payload(request.username, password, request.verify_ssl)
            response_payload = {
                **payload,
                "profile_key": request.profile_key or request.username,
                "school_account": request.username,
                "imported_at": now_iso(),
                "record_count": len(payload["records"]),
                "persisted_to_supabase": False,
            }
            if request.persist_to_supabase:
                response_payload["persisted_to_supabase"] = persist_history_snapshot(
                    response_payload["profile_key"],
                    request.username,
                    response_payload,
                )
            return HistoryImportResponse.model_validate(response_payload)
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"歷史修課系統請求失敗：{exc}") from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/api/history/{profile_key}", response_model=HistoryImportResponse)
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

    @router.post("/api/moodle/assignments/sync", response_model=MoodleAssignmentsResponse)
    def sync_moodle_assignments(
        request: MoodleAssignmentsRequest,
        authorization: str | None = Header(default=None),
    ) -> MoodleAssignmentsResponse:
        try:
            password = resolve_password(request.username, request.password, authorization)
            payload = fetch_moodle_payload(request.username, password, request.verify_ssl)
            response_payload = {
                **payload,
                "profile_key": request.profile_key or request.username,
                "school_account": request.username,
                "synced_at": now_iso(),
                "item_count": len(payload["items"]),
                "persisted_to_supabase": False,
            }
            if request.persist_to_supabase:
                response_payload["persisted_to_supabase"] = persist_moodle_snapshot(
                    response_payload["profile_key"],
                    request.username,
                    response_payload,
                )
            return MoodleAssignmentsResponse.model_validate(response_payload)
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"Moodle 待繳事項請求失敗：{exc}") from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/api/moodle/assignments/{profile_key}", response_model=MoodleAssignmentsResponse)
    def get_latest_moodle_assignments(profile_key: str) -> MoodleAssignmentsResponse:
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
