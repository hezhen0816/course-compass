from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

try:
    from ..core.config import DEFAULT_VERIFY_SSL
except ImportError:  # pragma: no cover
    from core.config import DEFAULT_VERIFY_SSL


class OfficialSelectionSyncRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str | None = None
    profile_key: str | None = None
    verify_ssl: bool = DEFAULT_VERIFY_SSL


class OfficialSelectionKeepAliveRequest(BaseModel):
    username: str = Field(min_length=1)
    profile_key: str | None = None
    verify_ssl: bool = DEFAULT_VERIFY_SSL


class OfficialSelectionCourseActionRequest(BaseModel):
    username: str = Field(min_length=1)
    course_no: str = Field(min_length=1)
    confirmed: bool = False
    password: str | None = None
    profile_key: str | None = None
    verify_ssl: bool = DEFAULT_VERIFY_SSL


class OfficialSelectionPriorityUpdateRequest(BaseModel):
    username: str = Field(min_length=1)
    ordered_course_nos: list[str] = Field(min_length=1)
    confirmed: bool = False
    password: str | None = None
    profile_key: str | None = None
    verify_ssl: bool = DEFAULT_VERIFY_SSL


class OfficialSelectionAvailableCourse(BaseModel):
    course_no: str
    course_name: str
    teacher: str
    gpa: float | None = None
    gpa_status: str = "not_enabled"


class OfficialSelectionRegisteredCourse(BaseModel):
    priority: int | None = None
    raw_priority: str = ""
    course_no: str
    course_name: str
    credits: float | None = None
    require_option: str = ""
    teacher: str = ""
    classroom: str = ""
    node: str = ""
    contents: str = ""
    selected_count: int | None = None
    capacity: int | None = None
    gpa: float | None = None
    gpa_status: str = "not_enabled"


class OfficialSelectionRequiredPresetCourse(BaseModel):
    course_no: str
    course_name: str
    credits: float | None = None
    require_option: str = ""
    teacher: str = ""
    classroom: str = ""
    node: str = ""
    contents: str = ""
    selected_count: int | None = None
    capacity: int | None = None
    gpa: float | None = None
    gpa_status: str = "not_enabled"


class OfficialSelectionSyncResponse(BaseModel):
    profile_key: str
    school_account: str
    source_url: str
    page_title: str
    synced_at: datetime
    session_valid: bool
    available_count: int
    registered_count: int
    available_courses: list[OfficialSelectionAvailableCourse]
    registered_courses: list[OfficialSelectionRegisteredCourse]
    schedule_rows: list[dict[str, str]]
    selection_list_rows: list[dict[str, str]]
    required_preset_rows: list[dict[str, str]]
    required_preset_courses: list[OfficialSelectionRequiredPresetCourse] = Field(default_factory=list)
    notices: list[str] = Field(default_factory=list)
