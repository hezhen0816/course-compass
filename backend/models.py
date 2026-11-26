from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

try:
    from .config import DEFAULT_VERIFY_SSL
except ImportError:  # pragma: no cover
    from config import DEFAULT_VERIFY_SSL

class SyncRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str | None = None
    profile_key: str | None = None
    persist_to_supabase: bool = True


class HistoryImportRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str | None = None
    profile_key: str | None = None
    persist_to_supabase: bool = True


class MoodleAssignmentsRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str | None = None
    profile_key: str | None = None
    persist_to_supabase: bool = True


class OfficialSelectionSyncRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str | None = None
    profile_key: str | None = None


class OfficialSelectionKeepAliveRequest(BaseModel):
    username: str = Field(min_length=1)
    profile_key: str | None = None


class OfficialSelectionCourseActionRequest(BaseModel):
    username: str = Field(min_length=1)
    course_no: str = Field(min_length=1)
    confirmed: bool = False
    password: str | None = None
    profile_key: str | None = None
    # 選課階段：初選 A02、加退選 B01。只有 add-to-waitlist 看它。
    period: Literal["A02", "B01"] = "A02"


class OfficialSelectionPriorityUpdateRequest(BaseModel):
    username: str = Field(min_length=1)
    ordered_course_nos: list[str] = Field(min_length=1)
    confirmed: bool = False
    password: str | None = None
    profile_key: str | None = None


class GpaApiKeySaveRequest(BaseModel):
    apiKey: str = Field(min_length=1)
    enabled: bool = True


class GpaApiKeyResponse(BaseModel):
    """The stored token is never sent back to the client — only whether it exists."""

    enabled: bool = False
    hasApiKey: bool = False
    updatedAt: str | None = None


class CourseRow(BaseModel):
    course_code: str
    course_name: str
    credits: float | str
    required_type: str
    professor: str
    note: str
    # Filled after sync when the caller has a myNTUST GPA key; absent otherwise.
    gpa: float | None = None
    gpa_status: str | None = None
    gpa_semester: int | None = None
    gpa_students: int | None = None
    gpa_teacher: str | None = None
    gpa_course_no: str | None = None


class ScheduleSlot(BaseModel):
    weekday_key: str
    weekday_label: str
    period: str
    time: str
    course_name: str
    location: str
    raw: str


class ScheduleEntryPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    weekday_key: str
    weekday_label: str
    title: str
    time_range: str
    slot_times: list[str] = []
    room: str
    instructor: str
    accent: str


class SyncResponse(BaseModel):
    profile_key: str
    school_account: str
    student_name: str | None = None
    source_url: str
    page_title: str
    total_credits_text: str
    total_credits: float | None
    synced_at: datetime
    course_count: int
    scheduled_slot_count: int
    schedule_entry_count: int
    persisted_to_supabase: bool
    courses: list[CourseRow]
    slots: list[ScheduleSlot]
    schedule_entries: list[ScheduleEntryPayload]


class HistoryCourseRecord(BaseModel):
    category: str
    course_code: str
    course_name: str
    academic_term: str
    grade: str
    earned_credits: str
    ge_dimension: str = ""


class HistoryImportResponse(BaseModel):
    profile_key: str
    school_account: str
    student_name: str | None = None
    student_no: str | None = None
    department: str | None = None
    status: str | None = None
    source_url: str
    page_title: str
    imported_at: datetime
    record_count: int
    persisted_to_supabase: bool
    summary_texts: list[str]
    records: list[HistoryCourseRecord]


class MoodleAssignmentItem(BaseModel):
    due_at: datetime
    title: str
    summary: str
    course_name: str
    action_label: str
    action_url: str
    event_url: str
    overdue: bool


class MoodleAssignmentsResponse(BaseModel):
    profile_key: str
    school_account: str
    source_url: str
    page_title: str
    timeline_filter: str
    synced_at: datetime
    item_count: int
    persisted_to_supabase: bool
    items: list[MoodleAssignmentItem]


class OfficialSelectionAvailableCourse(BaseModel):
    course_no: str
    course_name: str
    teacher: str


class OfficialSelectionRegisteredCourse(BaseModel):
    priority: int | None = None
    raw_priority: str = ""
    course_no: str
    course_name: str
    credits: float | None = None
    require_option: str = ""
    teacher: str = ""


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
    notices: list[str] = Field(default_factory=list)
    # Messages the school returned for the last add/drop action only; empty when
    # it said nothing specific. `notices` also carries the page-wide announcements.
    action_notices: list[str] = Field(default_factory=list)


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


class CourseSemesterInfo(BaseModel):
    semester: str
    english_label: str | None = None
    current: bool = False


class CourseSearchResult(BaseModel):
    semester: str
    course_no: str
    course_name: str
    teacher: str
    dimension: str
    credits: float | None
    require_option: str
    classroom: str
    node: str
    contents: str
    gpa: float | None = None
    gpa_status: str = "not_enabled"
    # Which class the GPA belongs to: myNTUST reports the latest semester a code
    # has grades for, and that class may have had a different teacher.
    gpa_semester: int | None = None
    gpa_students: int | None = None
    gpa_teacher: str | None = None
    gpa_course_no: str | None = None
    selected_count: int | None = None
    capacity: int | None = None


class GpaHistoryRowPayload(BaseModel):
    semester: int
    course_no: str
    teacher: str
    gpa: float | None = None
    students: int | None = None
    distribution: dict[str, int] | None = None


class GpaHistoryResponse(BaseModel):
    course_name: str
    # found / not_enabled / error / rate_limited；rate_limited 時 rows 仍回，只是部分班沒成績。
    status: str
    rows: list[GpaHistoryRowPayload] = Field(default_factory=list)


class PlannerRequirementPayload(BaseModel):
    id: str
    title: str
    credits: int = 3
    course_names: list[str] = Field(default_factory=list)
    required: bool = True
    department_prefixes: list[str] = Field(default_factory=list)
    # 學分池：從 course_names 裡挑不同的課湊到這個學分數；None＝一般單門需求。
    pool_credits: int | None = None


class PlannerSolveRequest(BaseModel):
    terms: list[str] = Field(min_length=1)
    requirements: list[PlannerRequirementPayload] = Field(min_length=1)
    min_credits: dict[str, int] = Field(default_factory=dict)
    max_credits: dict[str, int] = Field(default_factory=dict)
    reserved_credits: dict[str, int] = Field(default_factory=dict)
    prerequisites: list[list[str]] = Field(default_factory=list)  # [before_id, after_id]
    deadlines: dict[str, str] = Field(default_factory=dict)
    campus_gap: bool = True
    preference: str = "gpa"
    include_cross_school: bool = False
    # 使用者本系／雙主修／輔系的課碼前綴；不在裡面的班（例如管理學士班）多半選不到，排課時當高風險。
    preferred_prefixes: list[str] = Field(default_factory=list)


class PlannerPlacementPayload(BaseModel):
    term: str
    candidate_id: str
    requirement_id: str
    course_no: str
    name: str
    teacher: str
    credits: int
    slots: list[str]
    gpa: float | None = None
    students: int | None = None
    campus: str = ""
    risk: int = 0
    source_semester: str = ""
    contents: str = ""
    eligibility: str = "unknown"


class PlannerCandidatePayload(PlannerPlacementPayload):
    term: str = ""
    offered_terms: list[str] = Field(default_factory=list)


class PlannerSolveResponse(BaseModel):
    # found / not_enabled / rate_limited；求解本身的結果看 solver_status。
    status: str
    solver_status: str
    placements: list[PlannerPlacementPayload] = Field(default_factory=list)
    unplaced: list[dict[str, str]] = Field(default_factory=list)
    notes: dict[str, str] = Field(default_factory=dict)
    credits_by_term: dict[str, int] = Field(default_factory=dict)
    stages: list[dict[str, Any]] = Field(default_factory=list)
    candidates: list[PlannerCandidatePayload] = Field(default_factory=list)


class RequirementOptionPayload(BaseModel):
    name: str
    credits: float | None = None
    course_names: list[str] = Field(default_factory=list)


class PendingRequirementPayload(BaseModel):
    id: str
    set_id: str
    kind: str
    title: str
    credits: float | None = None
    required_credits: float | None = None
    course_names: list[str] = Field(default_factory=list)
    options: list[RequirementOptionPayload] = Field(default_factory=list)
    note: str = ""
    course_code_prefix: str | None = None
    # 開課系所欄 → 課碼前兩碼；多學期規劃與資格判斷用。
    department_prefixes: list[str] = Field(default_factory=list)


class RequirementSetPayload(BaseModel):
    id: str
    name: str
    department: str = ""
    source: str = "pdf"
    source_file_name: str | None = None
    total_credits: float | None = None
    notes: list[str] = Field(default_factory=list)


class RequirementSetImport(BaseModel):
    requirement_set: RequirementSetPayload
    pending_requirements: list[PendingRequirementPayload]


class RequirementPdfImportResponse(BaseModel):
    # 第一個表；一份 PDF 可能有好幾個系所的表，完整清單在 requirement_sets（iOS 仍讀前兩個欄位）。
    requirement_set: RequirementSetPayload
    pending_requirements: list[PendingRequirementPayload]
    requirement_sets: list[RequirementSetImport] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    raw_text_preview: str = ""
