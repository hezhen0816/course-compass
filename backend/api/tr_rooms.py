from __future__ import annotations

import requests
from fastapi import APIRouter, HTTPException

try:
    from ..config import DEFAULT_VERIFY_SSL
    from ..models import TRRoomStatusResponse
    from ..time_utils import now
    from ..tr_rooms import (
        build_tr_meetings,
        fetch_current_query_semester,
        fetch_query_courses,
        label_for_node,
        next_node_from_datetime,
        node_from_datetime,
        normalize_room_code,
        occupied_meetings,
        room_sort_key,
    )
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from config import DEFAULT_VERIFY_SSL
    from models import TRRoomStatusResponse
    from time_utils import now
    from tr_rooms import (
        build_tr_meetings,
        fetch_current_query_semester,
        fetch_query_courses,
        label_for_node,
        next_node_from_datetime,
        node_from_datetime,
        normalize_room_code,
        occupied_meetings,
        room_sort_key,
    )


def create_tr_rooms_router() -> APIRouter:
    router = APIRouter(prefix="/api/tr-rooms", tags=["tr-rooms"])

    @router.get("/status", response_model=TRRoomStatusResponse)
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

    return router
