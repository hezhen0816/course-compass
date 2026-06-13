from __future__ import annotations

from pydantic import BaseModel, Field


class SchoolCredentialsSaveRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class SchoolCredentialsResponse(BaseModel):
    username: str = ""
    hasPassword: bool = False
