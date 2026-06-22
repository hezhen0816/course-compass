from __future__ import annotations

from collections.abc import Callable
from typing import Any

import requests
from fastapi import APIRouter, File, Header, HTTPException, UploadFile

try:
    from ..core.errors import CredentialStoreError
    from ..schemas.planner import RequirementPdfImportResponse
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from core.errors import CredentialStoreError
    from schemas.planner import RequirementPdfImportResponse


RequirementPdfParser = Callable[[bytes, str], dict[str, Any]]
UserContextResolver = Callable[[str | None], tuple[str, str]]
TypedPlannerReader = Callable[[str], dict[str, Any]]


def create_planner_router(
    parse_requirement_pdf: RequirementPdfParser,
    current_user_context: UserContextResolver | None = None,
    read_typed_planner_data: TypedPlannerReader | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/api/planner", tags=["planner"])

    @router.get("/data")
    def get_typed_planner_data(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        if current_user_context is None or read_typed_planner_data is None:
            raise HTTPException(status_code=503, detail="Typed planner read API is not configured.")
        user_id, _access_token = current_user_context(authorization)
        try:
            return {
                "source": "typed",
                "data": read_typed_planner_data(user_id),
            }
        except CredentialStoreError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"讀取新版規劃資料失敗：{exc}") from exc

    @router.post("/import-requirements/pdf", response_model=RequirementPdfImportResponse)
    async def import_requirements_pdf(file: UploadFile = File(...)) -> RequirementPdfImportResponse:
        if file.content_type not in {None, "", "application/pdf", "application/octet-stream"}:
            raise HTTPException(status_code=400, detail="請上傳 PDF 檔案。")
        try:
            pdf_bytes = await file.read()
            if not pdf_bytes:
                raise RuntimeError("PDF 檔案是空的。")
            payload = parse_requirement_pdf(pdf_bytes, file.filename or "requirements.pdf")
            return RequirementPdfImportResponse.model_validate(payload)
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return router
