from __future__ import annotations

from pathlib import Path

import pytest

from backend import planner_pdf

PERSONAL = Path(__file__).resolve().parents[2] / "personal"
MINOR_PDF = PERSONAL / "minor-requirements.pdf"
DOUBLE_PDF = PERSONAL / "double-major-requirements.pdf"


def _finalized(table, title):
    entry = planner_pdf._parse_course_table(table, title, 1)
    planner_pdf._finalize_set(entry)
    return entry


def test_table_rows_become_requirements_with_alternatives_and_department_prefixes() -> None:
    entry = _finalized(
        [
            ["科目名稱", "學分數", "必選修", "開課系所", "備註"],
            ["經濟學或經濟學(上)或經濟學\n(下)", "3", "必修", "企業管理系\n財務金融學士\n學位學程", "必修12學分"],
            ["財務管理", "3", "必修", "企管系", ""],
            ["投資學", "3", "選修", "財務金融學士\n學位學程", "專業選修，任\n選12學分。"],
            ["債券市場", "3", "選修", "", ""],
            ["其他本學程開設之專業選修課程（課號為 FB 開頭）", "", "", "", ""],
            ["最低修習學分總數", "", "24 學分", "", ""],
        ],
        "114學年度財務金融學士學位學程輔系應修科目表",
    )
    assert entry["requirement_set"]["total_credits"] == 24
    assert entry["requirement_set"]["department"] == "財務金融學士學位學程"
    reqs = {r["title"]: r for r in entry["pending_requirements"]}
    econ = reqs["經濟學或經濟學(上)或經濟學(下)"]
    # 擇一不再是獨立的 kind：course_names 有多門就是擇一。
    assert econ["kind"] == "course" and econ["course_names"] == ["經濟學", "經濟學(上)", "經濟學(下)"]
    assert econ["department_prefixes"] == ["BA", "FB"]
    assert reqs["財務管理"]["department_prefixes"] == ["BA"]
    pool = next(r for r in entry["pending_requirements"] if r["kind"] == "credit_pool")
    assert pool["required_credits"] == 12 and pool["course_names"] == ["投資學", "債券市場"]
    assert pool["department_prefixes"] == ["FB"] and "其他 FB" in pool["note"]
    assert "投資學" not in reqs  # electives collapse into the pool


def test_compatibility_ideographs_are_folded_to_plain_characters() -> None:
    assert planner_pdf.compact_name("\ufa08銷管理") == "行銷管理"


def test_business_note_cell_yields_basic_courses_and_prefix_pool() -> None:
    entry = _finalized(
        [
            ["科目名稱", "學分數", "備註"],
            ["成本會計", "3", ""],
            ["實務專題(上)、實務專題(下)", "4", "1. 實務課程二選一"],
            ["企管校外實習", "4", ""],
            ["本系開設之專業課程（課號為BA開頭）\n共計18學分", "18", "其中企業實習相關課程之學分採計上限為5學分"],
            ["應修學分總數", "43學分", ""],
            ["備註：除上述應修學分總數43學分外，另須修習通過下列基礎課程：1.「微積分」3學分 2.「經濟學(上)3學分、經濟學(下)3學分」4.「管理與企業倫理」3學分", "", ""],
        ],
        "114學年度企業管理系雙主修應修科目表",
    )
    assert entry["requirement_set"]["total_credits"] == 43
    titles = [r["title"] for r in entry["pending_requirements"]]
    assert titles == ["成本會計", "實務課程二選一", "BA 開頭專業課程", "微積分", "經濟學(上)", "經濟學(下)", "管理與企業倫理"]
    assert entry["pending_requirements"][2]["kind"] == "credit_pool"
    assert entry["pending_requirements"][0]["department_prefixes"] == ["BA"]


@pytest.mark.skipif(not MINOR_PDF.exists(), reason="personal PDF not available")
def test_minor_pdf_reads_both_pages_into_one_set() -> None:
    parsed = planner_pdf.parse_requirement_pdf(MINOR_PDF.read_bytes(), MINOR_PDF.name)
    assert len(parsed["requirement_sets"]) == 1
    entry = parsed["requirement_sets"][0]
    assert entry["requirement_set"]["total_credits"] == 24
    pool = next(r for r in entry["pending_requirements"] if r["kind"] == "credit_pool")
    assert len(pool["course_names"]) == 16 and "保險學" in pool["course_names"]
    assert len(entry["pending_requirements"]) == 5


@pytest.mark.skipif(not DOUBLE_PDF.exists(), reason="personal PDF not available")
def test_double_major_pdf_yields_one_set_per_department() -> None:
    parsed = planner_pdf.parse_requirement_pdf(DOUBLE_PDF.read_bytes(), DOUBLE_PDF.name)
    names = [e["requirement_set"]["name"] for e in parsed["requirement_sets"]]
    assert names == ["114學年度資訊工程系雙主修應修科目表", "114學年度企業管理系雙主修應修科目表"]
    cs, ba = parsed["requirement_sets"]
    assert cs["requirement_set"]["total_credits"] == 47 and ba["requirement_set"]["total_credits"] == 43
    assert {r["title"] for r in ba["pending_requirements"]} >= {"成本會計", "BA 開頭專業課程", "微積分", "管理與企業倫理"}
    # the change-log table on page 2 must not add a third set or duplicate rows
    assert sum(1 for r in ba["pending_requirements"] if r["title"] == "實務課程二選一") == 1
    assert parsed["requirement_set"]["name"] == names[0]  # legacy first-set fields still filled
