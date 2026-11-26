from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, File, Header, HTTPException, UploadFile

try:
    from ..models import RequirementPdfImportResponse
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from models import RequirementPdfImportResponse


RequirementPdfParser = Callable[[bytes, str], dict[str, Any]]
UserContextResolver = Callable[[str | None], tuple[str, str]]

# 應修科目表通常幾百 KB；上限擋的是把整包讀進記憶體的濫用，不是正常使用。
MAX_PDF_BYTES = 8 * 1024 * 1024
_READ_CHUNK = 256 * 1024


def create_planner_router(
    parse_requirement_pdf: RequirementPdfParser,
    current_user_context: UserContextResolver,
) -> APIRouter:
    router = APIRouter(prefix="/api/planner", tags=["planner"])

    @router.post("/import-requirements/pdf", response_model=RequirementPdfImportResponse)
    async def import_requirements_pdf(
        file: UploadFile = File(...),
        authorization: str | None = Header(default=None),
    ) -> RequirementPdfImportResponse:
        # 解析結果只回給呼叫者、不落地，但這條路會把整份 PDF 讀進記憶體並跑 pdfplumber，
        # 沒登入不該能用。
        current_user_context(authorization)
        if file.content_type not in {None, "", "application/pdf", "application/octet-stream"}:
            raise HTTPException(status_code=400, detail="請上傳 PDF 檔案。")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = await file.read(_READ_CHUNK)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_PDF_BYTES:
                raise HTTPException(status_code=413, detail="PDF 超過 8 MB 上限。")
            chunks.append(chunk)
        pdf_bytes = b"".join(chunks)
        try:
            if not pdf_bytes:
                raise RuntimeError("PDF 檔案是空的。")
            payload = parse_requirement_pdf(pdf_bytes, file.filename or "requirements.pdf")
            return RequirementPdfImportResponse.model_validate(payload)
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return router
