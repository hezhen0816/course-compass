from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class TRRoomMeeting(BaseModel):
    room: str
    node: str
    course_no: str
    course_name: str
    teacher: str


class TRRoomStatusResponse(BaseModel):
    semester: str
    queried_at: datetime
    target: str
    node: str | None
    node_label: str
    is_class_time: bool
    room: str | None = None
    room_is_free: bool | None = None
    room_meetings: list[TRRoomMeeting] = Field(default_factory=list)
    free_rooms: list[str]
    busy_rooms: list[str]
    total_rooms: int
    note: str
