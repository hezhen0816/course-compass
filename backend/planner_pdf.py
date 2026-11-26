"""Parse NTUST 應修科目表 PDFs (雙主修 / 輔系) into requirement sets.

The school publishes these as real tables, so we read cells with pdfplumber
instead of regex-splitting text lines. One PDF can hold several tables (the
double-major booklet has one page per department), each becoming its own set.

Cell conventions seen in the 114 tables:
- 科目名稱 "甲 或 乙", "甲／乙", "甲或甲(上)或甲(下)" → one requirement with alternatives.
- 必選修 column "選修" plus a note "專業選修，任選12學分" on the first elective
  row → all elective rows collapse into one credit pool.
- 開課系所 column lists the departments whose section counts → department prefixes.
- "本系開設之專業課程（課號為BA開頭）共計18學分" → prefix-only credit pool.
- A trailing "備註：…基礎課程" cell → the 微積分/經濟/統計/倫理 extras.
- A second table with 異動類別 columns is the change log; skipped.
"""
from __future__ import annotations

import re
import tempfile
import unicodedata
from pathlib import Path
from typing import Any

COURSE_SEPARATOR_RE = re.compile(r"\s*(?:／|/|、|\s+或\s+|或)\s*")

# 開課系所 wording → course-number prefix. Same list the web uses for eligibility.
DEPARTMENT_PREFIXES: list[tuple[str, str]] = [
    ("企業管理系", "BA"),
    ("企管系", "BA"),
    ("財務金融學士學位學程", "FB"),
    ("財務金融", "FB"),
    ("工業管理系", "IM"),
    ("資訊管理系", "MI"),
    ("管理學士班", "MB"),
    ("資訊工程系", "CS"),
    ("電機工程系", "EE"),
    ("電子工程系", "ET"),
    ("機械工程系", "ME"),
    ("化學工程系", "CH"),
    ("營建工程系", "CT"),
    ("材料科學與工程系", "TX"),
    ("科技管理研究所", "TM"),
    ("應用科技學士學位學程", "AT"),
]

# 備註 says 經濟學 6 學分 = (上)3 + (下)3, so those become two requirements the planner can place separately.
BASIC_COURSES = [
    ("微積分", 3, ["微積分", "微積分(上)", "微積分(下)"]),
    ("經濟學(上)", 3, ["經濟學(上)", "經濟學"]),
    ("經濟學(下)", 3, ["經濟學(下)"]),
    ("統計學(上)", 3, ["統計學(上)", "統計學"]),
    ("統計學(下)", 3, ["統計學(下)"]),
    ("管理與企業倫理", 3, ["管理與企業倫理"]),
]


def clean_text(value: str) -> str:
    # The PDFs use CJK compatibility ideographs (U+FA08 for 行 in 行銷管理); myNTUST search
    # would never match them, so NFKC folds them back to the ordinary characters.
    return (
        unicodedata.normalize("NFKC", value or "")
        .replace("　", " ")
        .replace("（", "(")
        .replace("）", ")")
        .replace("，", ",")
        .replace("\n", " ")
        .strip()
    )


def compact_name(value: str) -> str:
    return re.sub(r"\s+", "", clean_text(value))


def split_alternatives(name: str) -> list[str]:
    alternatives = [compact_name(part) for part in COURSE_SEPARATOR_RE.split(name) if compact_name(part)]
    return alternatives or [compact_name(name)]


def make_id(prefix: str, index: int, title: str) -> str:
    slug = re.sub(r"[^0-9A-Za-z一-鿿]+", "-", title).strip("-").lower()
    return f"{prefix}-{index}-{slug[:32] or index}"


def department_prefixes(text: str) -> list[str]:
    found: list[str] = []
    compact = compact_name(text)
    for name, prefix in DEPARTMENT_PREFIXES:
        if name in compact and prefix not in found:
            found.append(prefix)
    return found


def _as_credits(value: str) -> float | None:
    match = re.search(r"\d+(?:\.\d+)?", value or "")
    return float(match.group(0)) if match else None


# ---------------------------------------------------------------------------
# PDF → pages of (title lines, tables)


def _extract_pages(pdf_bytes: bytes) -> list[dict[str, Any]]:
    try:
        import pdfplumber
    except ImportError as exc:  # pragma: no cover - dependency is declared in requirements.
        raise RuntimeError("後端缺少 pdfplumber，無法解析 PDF。") from exc

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        tmp_path = Path(tmp.name)
    pages: list[dict[str, Any]] = []
    try:
        with pdfplumber.open(tmp_path) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                tables = [
                    [[clean_text(cell or "") for cell in row] for row in table if any(cell for cell in row)]
                    for table in page.extract_tables()
                ]
                pages.append({"text": text, "tables": [t for t in tables if t]})
    finally:
        tmp_path.unlink(missing_ok=True)
    if not any(p["text"].strip() for p in pages):
        raise RuntimeError("PDF 沒有可抽取的文字層；v1 尚不支援掃描影像 OCR。")
    return pages


def _titles_in(text: str) -> list[str]:
    return [compact_name(line) for line in text.splitlines() if "應修科目表" in line]


# ---------------------------------------------------------------------------
# Tables → requirement sets


def parse_requirement_pdf(pdf_bytes: bytes, filename: str) -> dict[str, Any]:
    pages = _extract_pages(pdf_bytes)
    sets: list[dict[str, Any]] = []
    warnings: list[str] = []
    fallback_title = compact_name(Path(filename).stem)
    last_title = fallback_title
    # A title with no table on its page belongs to the next page's table (page 2 of the minor sheet).
    for page in pages:
        titles = _titles_in(page["text"]) or [last_title]
        title_iter = iter(titles)
        current_title = next(title_iter)
        for table in page["tables"]:
            if _is_change_log(table):
                continue
            if not _is_course_table(table):
                # No header: the previous table spilling onto this page (the minor sheet's elective list).
                if sets and not _titles_in(page["text"]):
                    _merge_sets(sets[-1], _parse_course_table([sets[-1]["_header"], *table], current_title, len(sets)))
                continue
            parsed = _parse_course_table(table, current_title, len(sets) + 1)
            if sets and sets[-1]["requirement_set"]["name"] == parsed["requirement_set"]["name"]:
                _merge_sets(sets[-1], parsed)
            else:
                sets.append(parsed)
            current_title = next(title_iter, current_title)
        last_title = current_title

    if not sets:
        warnings.append("未能辨識任何應修科目表格。")
    for entry in sets:
        _finalize_set(entry)
        if entry["requirement_set"]["total_credits"] is None:
            entry["requirement_set"]["notes"].append("未能辨識應修學分總數。")
    first = sets[0] if sets else _empty_set(fallback_title, filename)
    raw_preview = "\n".join(line for page in pages for line in page["text"].splitlines()[:12])[:2000]
    for entry in sets:
        entry["requirement_set"]["source_file_name"] = filename
    return {
        "requirement_set": first["requirement_set"],
        "pending_requirements": first["pending_requirements"],
        "requirement_sets": sets,
        "warnings": warnings,
        "raw_text_preview": raw_preview,
    }


def parse_requirement_text(text: str, filename: str = "requirements.pdf") -> dict[str, Any]:
    """Text-only fallback kept for callers that already have extracted text (tests)."""
    lines = [clean_text(line) for line in text.splitlines() if clean_text(line)]
    rows: list[list[str]] = []
    for line in lines:
        match = re.match(r"^(?P<name>.+?)\s+(?P<credits>\d+(?:\.\d+)?)\s*(?P<note>.*)$", line)
        if match:
            rows.append([match.group("name"), match.group("credits"), match.group("note")])
    title = next((compact_name(line) for line in lines if "應修科目表" in line), compact_name(Path(filename).stem))
    table = [["科目名稱", "學分數", "備註"], *rows]
    parsed = _parse_course_table(table, title, 1)
    _finalize_set(parsed)
    parsed["requirement_set"]["source_file_name"] = filename
    return {
        "requirement_set": parsed["requirement_set"],
        "pending_requirements": parsed["pending_requirements"],
        "requirement_sets": [parsed],
        "warnings": [],
        "raw_text_preview": "\n".join(lines[:30]),
    }


def _empty_set(title: str, filename: str) -> dict[str, Any]:
    return {
        "requirement_set": {
            "id": make_id("set", 1, title),
            "name": title,
            "department": "",
            "source": "pdf",
            "source_file_name": filename,
            "total_credits": None,
            "notes": [],
        },
        "pending_requirements": [],
    }


def _is_change_log(table: list[list[str]]) -> bool:
    header = "".join(compact_name(cell) for cell in table[0])
    return "異動類別" in header or "原科目名稱" in header


def _is_course_table(table: list[list[str]]) -> bool:
    header = "".join(compact_name(cell) for cell in table[0])
    return "科目名稱" in header and "學分" in header and not _is_change_log(table)


def _column_index(header: list[str], *keys: str) -> int | None:
    for index, cell in enumerate(header):
        compact = compact_name(cell)
        if any(key in compact for key in keys):
            return index
    return None


def _merge_sets(target: dict[str, Any], extra: dict[str, Any]) -> None:
    target["_rows"].extend(extra["_rows"])
    target["_notes"].extend(extra["_notes"])
    if extra["_total"] is not None:
        target["_total"] = extra["_total"]


def _parse_course_table(table: list[list[str]], title: str, set_index: int) -> dict[str, Any]:
    header = table[0]
    name_col = _column_index(header, "科目名稱") or 0
    credit_col = _column_index(header, "學分")
    kind_col = _column_index(header, "必選修", "必選")
    dept_col = _column_index(header, "開課系所", "開課")
    note_col = _column_index(header, "備註")
    rows: list[dict[str, Any]] = []
    notes: list[str] = []
    total: float | None = None
    for row in table[1:]:
        cells = [clean_text(c) for c in row]
        name = cells[name_col] if name_col < len(cells) else ""
        if not compact_name(name):
            name = next((c for c in cells if compact_name(c)), "")
        compact = compact_name(name)
        if not compact:
            continue
        if compact.startswith("備註"):
            notes.append(name)
            continue
        if "應修學分總數" in compact or "最低修習學分總數" in compact:
            total = _as_credits("".join(cells))
            continue
        # Continuation pages come back with shifted columns, so read by content, not position.
        others = [c for i, c in enumerate(cells) if i != name_col and compact_name(c)]
        kind = next((compact_name(c) for c in others if compact_name(c) in {"必修", "選修"}), "")
        credits_cell = cells[credit_col] if credit_col is not None and credit_col < len(cells) else ""
        credits = _as_credits(credits_cell) if re.fullmatch(r"\s*\d+(?:\.\d+)?\s*", credits_cell or "") else None
        if credits is None:
            credits = next((float(c) for c in others if re.fullmatch(r"\d+(?:\.\d+)?", compact_name(c))), None)
        departments = cells[dept_col] if dept_col is not None and dept_col < len(cells) else ""
        if not department_prefixes(departments):
            departments = next((c for c in others if department_prefixes(c)), "")
        note = cells[note_col] if note_col is not None and note_col < len(cells) else ""
        if not compact_name(note):
            note = next(
                (c for c in others if c not in {credits_cell, departments} and compact_name(c) not in {"必修", "選修"} and not re.fullmatch(r"\d+(?:\.\d+)?", compact_name(c)) and not department_prefixes(c)),
                "",
            )
        rows.append({"name": name, "credits": credits, "kind": kind, "departments": departments, "note": note})
    department_match = re.search(r"學年度(.+?)(雙主修|輔系)", title)
    department = department_match.group(1) if department_match else ""
    return {
        "requirement_set": {
            "id": make_id("set", set_index, title),
            "name": title,
            "department": department,
            "source": "pdf",
            "source_file_name": None,
            "total_credits": None,
            "notes": [],
        },
        "pending_requirements": [],
        "_header": header,
        "_rows": rows,
        "_notes": notes,
        "_total": total,
        "_program": "minor" if "輔系" in title else "double_major" if "雙主修" in title else "",
    }


def _finalize_set(entry: dict[str, Any]) -> None:
    rows: list[dict[str, Any]] = entry.pop("_rows", [])
    notes: list[str] = entry.pop("_notes", [])
    entry.pop("_header", None)
    total = entry.pop("_total", None)
    entry.pop("_program", None)
    set_id = entry["requirement_set"]["id"]
    entry["requirement_set"]["total_credits"] = total
    own_prefixes = department_prefixes(entry["requirement_set"]["department"])
    requirements: list[dict[str, Any]] = []

    # Elective pool: rows marked 選修 whose first row says 任選N學分.
    electives = [row for row in rows if row["kind"] == "選修"]
    pool_credits = None
    for row in electives:
        match = re.search(r"任選\s*(\d+)\s*學分", compact_name(row["note"]))
        if match:
            pool_credits = float(match.group(1))
            break
    seen: set[str] = set()
    pending_practical = False
    pool_extra_prefixes: list[str] = []
    for row in rows:
        title = compact_name(row["name"])
        if not title or title in seen:
            continue
        if row in electives and pool_credits is not None:
            continue
        other_match = re.match(r"^其他.*課號為([A-Z]{2})開頭", title)
        if other_match:
            pool_extra_prefixes.append(other_match.group(1))
            continue
        if "本系開設之專業課程" in title or title.startswith("共計"):
            prefix_match = re.search(r"課號為([A-Z]{2})開頭", title)
            credits = row["credits"] or _as_credits(title)
            requirements.append(
                {
                    "id": make_id("req", len(requirements) + 1, "專業課程學分池"),
                    "set_id": set_id,
                    "kind": "credit_pool",
                    "title": f"{prefix_match.group(1) if prefix_match else ''} 開頭專業課程".strip(),
                    "credits": credits,
                    "required_credits": credits,
                    "course_names": [],
                    "options": [],
                    "course_code_prefix": prefix_match.group(1) if prefix_match else (own_prefixes[0] if own_prefixes else None),
                    "department_prefixes": [prefix_match.group(1)] if prefix_match else own_prefixes,
                    "note": row["note"],
                }
            )
            seen.add(title)
            continue
        if title == "企管校外實習":
            continue
        if title.startswith("實務專題") or title.startswith("實務課程"):
            if not pending_practical:
                pending_practical = True
                requirements.append(
                    {
                        "id": make_id("req", len(requirements) + 1, "實務課程二選一"),
                        "set_id": set_id,
                        "kind": "course",
                        "title": "實務課程二選一",
                        "credits": 4,
                        "required_credits": 4,
                        "course_names": ["實務專題(上)", "實務專題(下)", "企管校外實習"],
                        "options": [
                            {"name": "實務專題(上)+實務專題(下)", "credits": 4, "course_names": ["實務專題(上)", "實務專題(下)"]},
                            {"name": "企管校外實習", "credits": 4, "course_names": ["企管校外實習"]},
                        ],
                        "course_code_prefix": None,
                        "department_prefixes": own_prefixes,
                        "note": "二選一；跨校雙主修學生依表格備註僅可修習實務專題(上)(下)。",
                    }
                )
            seen.add(title)
            continue
        requirements.append(_row_to_requirement(row, set_id, len(requirements) + 1, own_prefixes))
        seen.add(title)

    if electives and pool_credits is not None:
        names = [compact_name(row["name"]) for row in electives]
        prefixes = department_prefixes(electives[0]["departments"]) or own_prefixes
        for extra in pool_extra_prefixes:
            if extra not in prefixes:
                prefixes.append(extra)
        label = entry["requirement_set"]["department"] or "本系"
        requirements.append(
            {
                "id": make_id("req", len(requirements) + 1, "專業選修"),
                "set_id": set_id,
                "kind": "credit_pool",
                "title": f"{label}專業選修任選 {int(pool_credits)} 學分",
                "credits": pool_credits,
                "required_credits": pool_credits,
                "course_names": names,
                "options": [{"name": name, "credits": row["credits"], "course_names": [name]} for name, row in zip(names, electives)],
                "course_code_prefix": prefixes[0] if prefixes else None,
                "department_prefixes": prefixes,
                "note": (compact_name(electives[0]["note"]) or "表列課程任選")
                + ("；其他 " + "、".join(pool_extra_prefixes) + " 開頭專業選修亦可" if pool_extra_prefixes else ""),
            }
        )

    # 備註 cell: 基礎課程 extras (business double major)
    note_text = compact_name(" ".join(notes))
    if "基礎課程" in note_text:
        for title, credits, alternatives in BASIC_COURSES:
            if title.split("(")[0] in note_text:
                requirements.append(
                    {
                        "id": make_id("req", len(requirements) + 1, title),
                        "set_id": set_id,
                        "kind": "course",
                        "title": title,
                        "credits": credits,
                        "required_credits": credits,
                        "course_names": alternatives,
                        "options": [
                            {"name": name, "credits": credits if len(alternatives) == 1 else None, "course_names": [name]}
                            for name in alternatives
                        ],
                        "course_code_prefix": None,
                        "department_prefixes": [],
                        "note": "基礎課程",
                    }
                )
    if notes:
        entry["requirement_set"]["notes"].extend(compact_name(n)[:200] for n in notes)
    entry["pending_requirements"] = requirements


def _row_to_requirement(row: dict[str, Any], set_id: str, index: int, own_prefixes: list[str]) -> dict[str, Any]:
    title = compact_name(str(row["name"]))
    # 擇一與否看 course_names 有幾門就知道，不另立 kind（前端顯示也是這樣判斷）。
    alternatives = split_alternatives(title)
    prefixes = department_prefixes(str(row.get("departments", ""))) or own_prefixes
    return {
        "id": make_id("req", index, title),
        "set_id": set_id,
        "kind": "course",
        "title": title,
        "credits": row["credits"],
        "required_credits": row["credits"],
        "course_names": alternatives,
        "options": [{"name": name, "credits": row["credits"], "course_names": [name]} for name in alternatives],
        "course_code_prefix": None,
        "department_prefixes": prefixes,
        "note": clean_text(str(row.get("note", ""))),
    }
