from __future__ import annotations

import re
import tempfile
from pathlib import Path
from typing import Any

COURSE_SEPARATOR_RE = re.compile(r"\s*(?:／|/|\s+或\s+|或)\s*")


def clean_text(value: str) -> str:
    return (
        value.replace("\u3000", " ")
        .replace("行", "行")
        .replace("（", "(")
        .replace("）", ")")
        .replace("，", ",")
        .replace("、", "、")
        .strip()
    )


def compact_name(value: str) -> str:
    value = clean_text(value)
    value = re.sub(r"\s+", "", value)
    return value


def split_alternatives(name: str) -> list[str]:
    alternatives = [compact_name(part) for part in COURSE_SEPARATOR_RE.split(name) if compact_name(part)]
    return alternatives or [compact_name(name)]


def make_id(prefix: str, index: int, title: str) -> str:
    slug = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", "-", title).strip("-").lower()
    if not slug:
        slug = str(index)
    return f"{prefix}-{index}-{slug[:32]}"


def extract_pdf_text(pdf_bytes: bytes) -> str:
    try:
        import pdfplumber
    except ImportError as exc:  # pragma: no cover - dependency is declared in requirements.
        raise RuntimeError("後端缺少 pdfplumber，無法解析 PDF。") from exc

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        tmp_path = Path(tmp.name)

    try:
        chunks: list[str] = []
        with pdfplumber.open(tmp_path) as pdf:
            for page in pdf.pages:
                chunks.append(page.extract_text(layout=True) or "")
        text = "\n".join(chunks)
    finally:
        tmp_path.unlink(missing_ok=True)

    if not text.strip():
        raise RuntimeError("PDF 沒有可抽取的文字層；v1 尚不支援掃描影像 OCR。")
    return text


def parse_requirement_pdf(pdf_bytes: bytes, filename: str) -> dict[str, Any]:
    text = extract_pdf_text(pdf_bytes)
    return parse_requirement_text(text, filename)


def parse_requirement_text(text: str, filename: str = "requirements.pdf") -> dict[str, Any]:
    normalized_lines = [clean_text(line) for line in text.splitlines()]
    lines = [line for line in normalized_lines if line]
    title = next((line for line in lines if "雙主修應修科目表" in line), Path(filename).stem)
    set_name = compact_name(title)
    total_credits = _extract_total_credits(lines)
    department = _extract_department(set_name)
    set_id = make_id("set", 1, set_name)
    warnings: list[str] = []

    if "資訊工程系" in set_name:
        requirements = _parse_cs_requirements(lines, set_id)
    elif "企業管理系" in set_name:
        requirements = _parse_business_requirements(lines, set_id)
    else:
        requirements = _parse_generic_requirements(lines, set_id)
        warnings.append("此 PDF 不是已知版型，已用一般表格規則解析，請在匯入預覽確認。")

    if total_credits is None:
        warnings.append("未能辨識應修學分總數。")
    if not requirements:
        warnings.append("未能辨識任何待修需求。")

    return {
        "requirement_set": {
            "id": set_id,
            "name": set_name,
            "department": department,
            "source": "pdf",
            "source_file_name": filename,
            "total_credits": total_credits,
            "notes": [],
        },
        "pending_requirements": requirements,
        "warnings": warnings,
        "raw_text_preview": "\n".join(lines[:30]),
    }


def _extract_department(set_name: str) -> str:
    match = re.search(r"學年度(.+?)雙主修", set_name)
    return match.group(1) if match else ""


def _extract_total_credits(lines: list[str]) -> float | None:
    for line in lines:
        compact = compact_name(line)
        if "應修學分總數" in compact or "應修總學分數" in compact:
            match = re.search(r"(\d+(?:\.\d+)?)", compact)
            if match:
                return float(match.group(1))
    return None


def _parse_cs_requirements(lines: list[str], set_id: str) -> list[dict[str, Any]]:
    rows = _course_rows(lines, stop_at_patterns=("應修學分總數",))
    return [_row_to_requirement(row, set_id, index + 1) for index, row in enumerate(rows)]


def _parse_business_requirements(lines: list[str], set_id: str) -> list[dict[str, Any]]:
    requirements: list[dict[str, Any]] = []
    main_rows = _course_rows(lines, stop_at_patterns=("應修學分總數",))
    seen_titles: set[str] = set()

    for row in main_rows:
        title = compact_name(row["name"])
        if not title or title in seen_titles:
            continue
        if "本系開設之專業課程" in title or title == "共計18學分":
            continue
        if title == "企管校外實習":
            continue
        if title.startswith("實務專題"):
            requirements.append(
                {
                    "id": make_id("req", len(requirements) + 1, "實務課程二選一"),
                    "set_id": set_id,
                    "kind": "choice",
                    "title": "實務課程二選一",
                    "credits": 4,
                    "required_credits": 4,
                    "course_names": ["實務專題(上)", "實務專題(下)", "企管校外實習"],
                    "options": [
                        {"name": "實務專題(上)+實務專題(下)", "credits": 4, "course_names": ["實務專題(上)", "實務專題(下)"]},
                        {"name": "企管校外實習", "credits": 4, "course_names": ["企管校外實習"]},
                    ],
                    "note": "二選一；跨校雙主修學生依表格備註僅可修習實務專題(上)(下)。",
                }
            )
            seen_titles.add(title)
            continue
        requirements.append(_row_to_requirement(row, set_id, len(requirements) + 1))
        seen_titles.add(title)

    if any("本系開設之專業課程" in compact_name(line) or "共計18學分" in compact_name(line) for line in lines):
        requirements.append(
            {
                "id": make_id("req", len(requirements) + 1, "BA 開頭專業課程"),
                "set_id": set_id,
                "kind": "credit_pool",
                "title": "BA 開頭專業課程",
                "credits": 18,
                "required_credits": 18,
                "course_names": [],
                "options": [],
                "course_code_prefix": "BA",
                "note": "本系開設之專業課程，課號為 BA 開頭，共計 18 學分；企業實習相關課程採計上限 5 學分。",
            }
        )

    for title, credits, alternatives in [
        ("微積分", 3, ["微積分", "微積分(上)", "微積分(下)"]),
        ("經濟學", 6, ["經濟學", "經濟學(上)", "經濟學(下)"]),
        ("統計學", 6, ["統計學", "統計學(上)", "統計學(下)"]),
        ("管理與企業倫理", 3, ["管理與企業倫理"]),
    ]:
        if any(title in compact_name(line) for line in lines):
            requirements.append(
                {
                    "id": make_id("req", len(requirements) + 1, title),
                    "set_id": set_id,
                    "kind": "choice" if len(alternatives) > 1 else "course",
                    "title": title,
                    "credits": credits,
                    "required_credits": credits,
                    "course_names": alternatives,
                    "options": [{"name": name, "credits": credits if len(alternatives) == 1 else None, "course_names": [name]} for name in alternatives],
                    "note": "基礎課程",
                }
            )

    return requirements


def _parse_generic_requirements(lines: list[str], set_id: str) -> list[dict[str, Any]]:
    rows = _course_rows(lines, stop_at_patterns=("應修學分總數", "備註"))
    return [_row_to_requirement(row, set_id, index + 1) for index, row in enumerate(rows)]


def _course_rows(lines: list[str], stop_at_patterns: tuple[str, ...]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    started = False
    for line in lines:
        compact = compact_name(line)
        if "科目名稱" in compact and "學分" in compact:
            started = True
            continue
        if not started:
            continue
        if any(pattern in compact for pattern in stop_at_patterns):
            break
        if any(skip in compact for skip in ("備註:", "修訂及重補修", "異動類別", "前原科目名稱")):
            continue
        match = re.match(r"^(?P<name>.+?)\s+(?P<credits>\d+(?:\.\d+)?)\s*(?P<note>.*)$", line)
        if not match:
            continue
        name = compact_name(match.group("name"))
        note = clean_text(match.group("note"))
        if not name or name.isdigit() or name in {"必修", "共計"}:
            continue
        rows.append({"name": name, "credits": float(match.group("credits")), "note": note})
    return rows


def _row_to_requirement(row: dict[str, Any], set_id: str, index: int) -> dict[str, Any]:
    title = compact_name(str(row["name"]))
    alternatives = split_alternatives(title)
    is_choice = len(alternatives) > 1 or "二擇一" in str(row.get("note", ""))
    kind = "choice" if is_choice else "course"
    return {
        "id": make_id("req", index, title),
        "set_id": set_id,
        "kind": kind,
        "title": title,
        "credits": row["credits"],
        "required_credits": row["credits"],
        "course_names": alternatives,
        "options": [{"name": name, "credits": row["credits"], "course_names": [name]} for name in alternatives],
        "note": clean_text(str(row.get("note", ""))),
    }
