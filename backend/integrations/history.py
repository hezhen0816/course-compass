from __future__ import annotations

import re
from typing import Any

import requests
from bs4 import BeautifulSoup, Tag

try:
    from ..config import SCORE_DISPLAY_ALL_URL
    from ..time_utils import now
    from .ntust_common import login_to_target, normalize
except ImportError:  # pragma: no cover
    from config import SCORE_DISPLAY_ALL_URL
    from integrations.ntust_common import login_to_target, normalize
    from time_utils import now


def extract_score_display_course_tables(soup: BeautifulSoup) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []

    for table in soup.find_all("table"):
        table_rows = table.find_all("tr")
        if not table_rows:
            continue

        header_cells = [normalize(cell.get_text(" ", strip=True)) for cell in table_rows[0].find_all(["td", "th"])]
        if header_cells[:9] != ["序", "學年期", "課程代碼", "課程名稱", "學分數", "成績", "備註說明", "通識向度", "遠距教學課程"]:
            continue

        for tr in table_rows[1:]:
            cells = [normalize(cell.get_text(" ", strip=True)) for cell in tr.find_all("td")]
            if len(cells) < 6 or not cells[2]:
                continue
            ge_dimension = cells[7] if len(cells) > 7 else ""
            rows.append(
                {
                    "category": f"通識向度 {ge_dimension}" if ge_dimension else "歷年學業成績",
                    "course_code": cells[2],
                    "course_name": cells[3],
                    "academic_term": cells[1],
                    "grade": cells[5],
                    "earned_credits": _normalize_score_credit(cells[4]),
                    "ge_dimension": ge_dimension,
                }
            )

    return rows


def extract_history_course_tables(soup: BeautifulSoup) -> list[dict[str, Any]]:
    score_rows = extract_score_display_course_tables(soup)
    if score_rows:
        return score_rows

    rows: list[dict[str, Any]] = []

    for title_cell in soup.select("td.TD_title1_C"):
        section_title = normalize(title_cell.get_text(" ", strip=True))
        section_table = title_cell.find_parent("table")
        if not isinstance(section_table, Tag):
            continue

        for table in section_table.find_all("table"):
            tr_rows = table.find_all("tr", recursive=False)
            if not tr_rows:
                tr_rows = table.find_all("tr")
            if not tr_rows:
                continue

            header_cells = [normalize(cell.get_text(" ", strip=True)) for cell in tr_rows[0].find_all(["td", "th"])]
            if header_cells[:5] != ["課程代碼", "課程名稱", "學年期", "成績", "實得學分"]:
                continue

            for tr in tr_rows[1:]:
                cells = [normalize(cell.get_text(" ", strip=True)) for cell in tr.find_all("td")]
                if len(cells) < 5 or not cells[0]:
                    continue
                rows.append(
                    {
                        "category": section_title,
                        "course_code": cells[0],
                        "course_name": cells[1],
                        "academic_term": cells[2],
                        "grade": cells[3],
                        "earned_credits": cells[4],
                        "ge_dimension": "",
                    }
                )

    return rows


def _normalize_score_credit(value: str) -> str:
    match = re.search(r"\d+(?:\.\d+)?", value)
    return match.group(0) if match else value


def extract_history_summary_texts(soup: BeautifulSoup) -> list[str]:
    summaries: list[str] = []
    for cell in soup.find_all("td", align="right"):
        text = normalize(cell.get_text(" ", strip=True))
        if "學分" in text:
            summaries.append(text)
    return summaries


def fetch_history_records(username: str, password: str, verify_ssl: bool) -> dict[str, Any]:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        }
    )

    page_response = login_to_target(session, username, password, SCORE_DISPLAY_ALL_URL, verify_ssl)
    soup = BeautifulSoup(page_response.text, "html.parser")

    student_name = _extract_score_student_name(soup)
    student_no = _extract_labeled_text(soup, "#ContentPlaceHolder1_Lal_StudentNo") or username
    department = _extract_labeled_text(soup, "#ContentPlaceHolder1_Lal_Subject")
    status = _extract_labeled_text(soup, "#ContentPlaceHolder1_Lal_Nowcondition")

    records = extract_history_course_tables(soup)
    summary_texts = extract_history_summary_texts(soup)

    return {
        "source_url": page_response.url,
        "page_title": normalize(soup.title.get_text(" ", strip=True) if soup.title else ""),
        "student_name": student_name or None,
        "student_no": student_no or None,
        "department": department or None,
        "status": status or None,
        "summary_texts": summary_texts,
        "records": records,
    }


def _extract_labeled_text(soup: BeautifulSoup, selector: str) -> str:
    element = soup.select_one(selector)
    return normalize(element.get_text(" ", strip=True) if element else "")


def _extract_score_student_name(soup: BeautifulSoup) -> str:
    excluded = {"登出", "登出系統", "Logout", "Log out", "Sign out", "English", "中文", "繁體中文", "簡體中文"}
    for link in soup.select("ul.navbar-right a.nav-link"):
        text = normalize(link.get_text(" ", strip=True))
        if text and text not in excluded:
            return text
    return _extract_labeled_text(soup, "#ContentPlaceHolder1_Lal_StudentName")
