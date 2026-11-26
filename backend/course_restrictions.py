"""Parse and evaluate the school's course-query ``Contents`` restrictions.

This module mirrors ``web/src/shared/domain/courseRestrictions.ts``.  Keep the
two implementations in sync when the school adds a new note convention.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal


RestrictionKind = Literal[
    "eligibility",
    "parity",
    "method",
    "language",
    "campus",
    "format",
    "capacity",
    "prerequisite",
    "other",
]
EligibilityLevel = Literal["open", "signature", "blocked", "unknown"]


@dataclass(frozen=True)
class RestrictionTag:
    kind: RestrictionKind
    label: str
    raw: str


@dataclass
class Eligibility:
    level: EligibilityLevel
    label: str
    reasons: list[str]


DEPARTMENT_ALIASES: tuple[tuple[re.Pattern[str], tuple[str, ...]], ...] = (
    (re.compile(r"企管|企業管理"), ("BA",)),
    (re.compile(r"資管|資訊管理"), ("MI",)),
    (re.compile(r"工管|工業管理"), ("IM",)),
    (re.compile(r"管理學士班|四管理|管理一|管理學士"), ("MB",)),
    (re.compile(r"財金|財務金融"), ("FB",)),
    (re.compile(r"資工|資訊工程"), ("CS",)),
    (re.compile(r"電機"), ("EE",)),
    (re.compile(r"電資學院|電資"), ("EE", "CS", "EC", "EO", "ET")),
    (re.compile(r"管理學院|管院"), ("BA", "MI", "IM", "MB", "FB", "TM", "MG", "MA")),
)

OPEN_ALL_PATTERNS = (
    re.compile(r"開放全校"),
    re.compile(r"開放外系"),
    re.compile(r"開放.*大學部學生選修"),
    re.compile(r"開放.*學院.*選修"),
)


def _normalize(text: str) -> str:
    return re.sub(r"\s+", "", text).replace("（", "(").replace("）", ")")


def split_contents(contents: str) -> list[str]:
    normalized = _normalize(contents or "")
    parts = re.split(r"[／/]", normalized)
    split_parts: list[str] = []
    for part in parts:
        # 「初選限本校資管系學生選課，加退選開放外系選課」是兩條規則寫在一格。
        split_parts.extend(re.split("，", part) if re.search(r"限.*，.*開放|開放.*，.*限", part) else [part])
    return [part.strip() for part in split_parts if part.strip()]


def _department_codes_in(text: str) -> list[str]:
    codes: list[str] = []
    seen: set[str] = set()
    for pattern, aliases in DEPARTMENT_ALIASES:
        if pattern.search(text):
            for code in aliases:
                if code not in seen:
                    seen.add(code)
                    codes.append(code)
    return codes


def _classify(part: str) -> RestrictionTag:
    raw = part
    if re.fullmatch(r"限\d+人", part):
        return RestrictionTag("capacity", part, raw)
    if re.search(r"EMI|英語授課|全英語", part):
        return RestrictionTag("language", "EMI 英語授課", raw)
    if re.search(r"華夏", part):
        return RestrictionTag("campus", "華夏校區", raw)
    if re.search(r"遠距", part):
        return RestrictionTag("format", "遠距", raw)
    if re.search(r"合班", part):
        return RestrictionTag("format", "合班上課", raw)
    if re.search(r"PBL", part):
        return RestrictionTag("format", "PBL", raw)
    if re.search(r"業界師資|協同教學", part):
        return RestrictionTag("format", "業界協同", raw)
    if re.search(r"演算課", part):
        return RestrictionTag("format", "含演算課", raw)
    if re.search(r"授權碼", part):
        return RestrictionTag("method", "授權碼", raw)
    if re.search(r"不開放電腦選課|請洽開課單位", part):
        return RestrictionTag("method", "不開放電腦選課", raw)
    if re.search(r"不開放加簽", part):
        return RestrictionTag("method", "不開放加簽", raw)
    if re.search(r"遴選", part):
        return RestrictionTag("eligibility", "遴選不開放", raw)
    if re.search(r"(單|雙)號|(單|雙)數", part):
        parity = "單號" if re.search(r"單", part) else "雙號"
        cohort_match = re.search(r"[四二]?[企資工管]{1,2}[一二三四]", part)
        cohort = cohort_match.group(0) if cohort_match else ""
        return RestrictionTag("parity", f"{cohort}{parity}" if cohort else parity, raw)
    if re.match(r"^限.*除\d+餘\d+", part):
        label = re.sub(r"學號除\d+餘\d+者?(修讀|修習|選課)?$", "", part)
        label = re.sub(r"^限", "限", label)
        return RestrictionTag("eligibility", label, raw)
    if re.search(r"除\d+餘\d+", part):
        return RestrictionTag("parity", "學號分班", raw)
    if re.search(r"修過|先修", part):
        return RestrictionTag("prerequisite", re.sub(r"^限", "", part), raw)
    if any(pattern.search(part) for pattern in OPEN_ALL_PATTERNS):
        phase = "加退選" if re.search(r"加退選", part) else "初選" if re.search(r"初選", part) else ""
        if re.search(r"全校", part):
            scope = "全校"
        elif re.search(r"外系", part):
            scope = "外系"
        elif re.search(r"學院", part):
            college_match = re.search(r"開放(.*?學院)", part)
            scope = college_match.group(1) if college_match else "外系"
        else:
            scope = "外系"
        return RestrictionTag("eligibility", f"{phase + '開放' if phase else '開放'}{scope}", raw)
    if re.search(r"^限|限.*(學生|生)(選課|選修|修習|修讀)", part):
        return RestrictionTag("eligibility", re.sub(r"(學生)?(選課|選修|修習|修讀)$", "", part), raw)
    if re.search(r"上課地點|上課節次|上課時間", part):
        return RestrictionTag("other", part, raw)
    return RestrictionTag("other", part, raw)


def parse_course_restrictions(contents: str) -> list[RestrictionTag]:
    tags: list[RestrictionTag] = []
    seen: set[tuple[RestrictionKind, str]] = set()
    for part in split_contents(contents):
        tag = _classify(part)
        key = (tag.kind, tag.label)
        if key in seen:
            continue
        seen.add(key)
        tags.append(tag)
    return tags


def evaluate_eligibility(
    course_no: str,
    contents: str,
    identity_prefixes: set[str],
    phase: str,
) -> Eligibility:
    tags = parse_course_restrictions(contents)
    my_codes = {code.strip().upper() for code in identity_prefixes if code and code.strip()}
    course_code = course_no.strip()[:2].upper()
    reasons: list[str] = []

    if not my_codes:
        return Eligibility("unknown", "身分未設定", ["到「設定」填主修／雙主修／輔系後才能判斷資格。"])

    is_my_department = course_code in my_codes
    in_add_drop = phase in {"addDrop", "correction"}

    # 1. 明講限系所：對得上任一身分就過，否則擋。「初選限本系」只在初選期算數。
    department_gate: Literal["pass", "fail"] | None = None
    for tag in tags:
        if not re.match(r"^(初選)?限", tag.raw):
            continue
        if re.match(r"^初選限", tag.raw) and in_add_drop:
            continue
        if re.search(r"在職|碩專|碩士班|研究生|博士", tag.raw):
            department_gate = "fail"
            reasons.append(f"備註「{tag.raw}」，不是大學部能選的班。")
            continue
        codes = _department_codes_in(tag.raw)
        if re.search(r"本系|本校.*系", tag.raw) and not codes:
            codes.append(course_code)
        if not codes:
            continue
        if any(code in my_codes for code in codes):
            if department_gate is None:
                department_gate = "pass"
        else:
            department_gate = "fail"
            reasons.append(f"備註「{tag.raw}」，你的主修／雙主修／輔系都不在內。")

    # 2. 開放全校／外系：初選寫「加退選開放」的，要到加退選才算。
    open_to_all = False
    for tag in tags:
        if tag.kind != "eligibility" or not any(pattern.search(tag.raw) for pattern in OPEN_ALL_PATTERNS):
            continue
        if re.search(r"加退選", tag.raw) and not in_add_drop:
            reasons.append(f"「{tag.raw}」：要等加退選才開放。")
            continue
        if re.search(r"學院", tag.raw) and not re.search(r"全校", tag.raw):
            codes = _department_codes_in(tag.raw)
            if codes and not any(code in my_codes for code in codes):
                reasons.append(f"「{tag.raw}」：你不在該學院。")
                continue
        open_to_all = True

    needs_code = any(tag.kind == "method" and re.search(r"授權碼|不開放電腦選課", tag.raw) for tag in tags)
    no_signature = any(tag.label == "不開放加簽" for tag in tags)
    selective = any(tag.label == "遴選不開放" for tag in tags)

    if department_gate == "fail" and not open_to_all:
        if no_signature:
            reasons.append("且標明不開放加簽。")
        return Eligibility("blocked", "資格不符", reasons)

    if needs_code:
        reasons.append("要向授課老師取得授權碼。")
        return Eligibility("signature", "需加簽", reasons)

    if selective and not is_my_department and not open_to_all:
        reasons.append("遴選班：不是本系／雙主修／輔系的課，電腦選不到，要人工加簽。")
        return Eligibility("signature", "需加簽", reasons)

    # The TypeScript implementation can add a student-number parity reminder.
    # The planner contract intentionally supplies department prefixes only, so
    # it cannot reproduce that non-blocking reminder without a student ID.
    if selective and is_my_department:
        reasons.append("遴選班，但這是你的系所／雙主修／輔系，實測選得進。")
    if open_to_all and not is_my_department:
        reasons.append("外系但已開放。")
    return Eligibility("open", "可直選", reasons)


# Keep the source function names discoverable for code that compares this port
# with the TypeScript module, while the public Python API uses snake_case.
splitContents = split_contents
parseCourseRestrictions = parse_course_restrictions
evaluateEligibility = evaluate_eligibility
