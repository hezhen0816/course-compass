from __future__ import annotations

from pydantic import BaseModel


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
    selected_count: int | None = None
    capacity: int | None = None
