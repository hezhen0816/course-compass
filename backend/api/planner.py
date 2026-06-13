from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile

try:
    from ..schemas.models import RequirementPdfImportResponse
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from schemas.models import RequirementPdfImportResponse


RequirementPdfParser = Callable[[bytes, str], dict[str, Any]]


def create_planner_router(parse_requirement_pdf: RequirementPdfParser) -> APIRouter:
    router = APIRouter(prefix="/api/planner", tags=["planner"])

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
