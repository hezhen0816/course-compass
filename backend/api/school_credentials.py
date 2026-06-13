from __future__ import annotations

from collections.abc import Callable

import requests
from fastapi import APIRouter, Header, HTTPException

try:
    from ..credentials import CredentialStoreError
    from ..schemas.school_credentials import SchoolCredentialsResponse, SchoolCredentialsSaveRequest
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from credentials import CredentialStoreError
    from schemas.school_credentials import SchoolCredentialsResponse, SchoolCredentialsSaveRequest


UserContextResolver = Callable[[str | None], tuple[str, str]]
SessionDeleteHandler = Callable[[tuple[str, str] | None, str | None], None]
CredentialsStatusReader = Callable[[str, str], dict[str, object]]
CredentialsWriter = Callable[[str, str, str, str], dict[str, object]]
CredentialsDeleteHandler = Callable[[str, str], dict[str, object]]


def create_school_credentials_router(
    current_user_context: UserContextResolver,
    delete_official_session: SessionDeleteHandler,
    read_credentials_status: CredentialsStatusReader,
    write_credentials: CredentialsWriter,
    delete_credentials: CredentialsDeleteHandler,
) -> APIRouter:
    router = APIRouter(prefix="/api/school-credentials", tags=["school-credentials"])

    @router.get("", response_model=SchoolCredentialsResponse)
    def get_saved_school_credentials(authorization: str | None = Header(default=None)) -> SchoolCredentialsResponse:
        user_id, access_token = current_user_context(authorization)
        try:
            return SchoolCredentialsResponse.model_validate(read_credentials_status(user_id, access_token))
        except CredentialStoreError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"讀取校務帳密失敗：{exc}") from exc

    @router.put("", response_model=SchoolCredentialsResponse)
    def save_school_credentials(
        request: SchoolCredentialsSaveRequest,
        authorization: str | None = Header(default=None),
    ) -> SchoolCredentialsResponse:
        user_id, access_token = current_user_context(authorization)
        try:
            delete_official_session((user_id, access_token), request.username.strip())
            return SchoolCredentialsResponse.model_validate(
                write_credentials(user_id, request.username.strip(), request.password, access_token)
            )
        except CredentialStoreError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"保存校務帳密失敗：{exc}") from exc

    @router.delete("", response_model=SchoolCredentialsResponse)
    def remove_saved_school_credentials(authorization: str | None = Header(default=None)) -> SchoolCredentialsResponse:
        user_id, access_token = current_user_context(authorization)
        try:
            delete_official_session((user_id, access_token), None)
            return SchoolCredentialsResponse.model_validate(delete_credentials(user_id, access_token))
        except CredentialStoreError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"刪除校務帳密失敗：{exc}") from exc

    return router
