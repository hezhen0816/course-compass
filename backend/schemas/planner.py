from __future__ import annotations

from pydantic import BaseModel, Field


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


class RequirementSetPayload(BaseModel):
    id: str
    name: str
    department: str = ""
    source: str = "pdf"
    source_file_name: str | None = None
    total_credits: float | None = None
    notes: list[str] = Field(default_factory=list)


class RequirementPdfImportResponse(BaseModel):
    requirement_set: RequirementSetPayload
    pending_requirements: list[PendingRequirementPayload]
    warnings: list[str] = Field(default_factory=list)
    raw_text_preview: str = ""
