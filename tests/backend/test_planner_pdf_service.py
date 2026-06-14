from __future__ import annotations

from pathlib import Path

import pytest

from backend.services import planner_pdf


def test_requirement_pdf_parser_preserves_cs_choices() -> None:
    pdf_path = Path("/Users/hezhen/Downloads/114double 資工.pdf")
    if not pdf_path.exists():
        pytest.skip("local sample PDF is not available")

    parsed = planner_pdf.parse_requirement_pdf(pdf_path.read_bytes(), pdf_path.name)

    assert parsed["requirement_set"]["name"] == "114學年度資訊工程系雙主修應修科目表"
    assert parsed["requirement_set"]["total_credits"] == 47
    choices = {item["title"]: item for item in parsed["pending_requirements"] if item["kind"] == "choice"}
    assert choices["資訊工程導論或計算機概論"]["course_names"] == ["資訊工程導論", "計算機概論"]
    assert choices["程式語言或編譯器設計"]["course_names"] == ["程式語言", "編譯器設計"]
    assert any(item["title"] == "資料結構" for item in parsed["pending_requirements"])


def test_requirement_pdf_parser_preserves_business_credit_pool() -> None:
    pdf_path = Path("/Users/hezhen/Downloads/114double 企管.pdf")
    if not pdf_path.exists():
        pytest.skip("local sample PDF is not available")

    parsed = planner_pdf.parse_requirement_pdf(pdf_path.read_bytes(), pdf_path.name)

    assert parsed["requirement_set"]["name"] == "114學年度企業管理系雙主修應修科目表"
    assert parsed["requirement_set"]["total_credits"] == 43
    by_title = {item["title"]: item for item in parsed["pending_requirements"]}
    assert by_title["會計學／會計學(上)／初級會計學"]["course_names"] == ["會計學", "會計學(上)", "初級會計學"]
    assert by_title["BA 開頭專業課程"]["kind"] == "credit_pool"
    assert by_title["BA 開頭專業課程"]["required_credits"] == 18
    assert by_title["微積分"]["note"] == "基礎課程"
