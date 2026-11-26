"""Turn myNTUST teaching history into solver candidates.

For each requirement the caller names the course titles that satisfy it. Every
(course_no, lecturer) pair that has taught under one of those titles becomes a
candidate: its timetable comes from the latest offering, its GPA from that
teacher's own graded class (see gpa.resolve_section_gpa), and it is offered in
a plan term when the same code+teacher ran in the same half-year (fall/spring)
within the look-back window.
"""
from __future__ import annotations

import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

import requests

try:
    from .course_restrictions import evaluate_eligibility
    from .gpa import GpaResult, HistoryRow, fetch_course_history, normalize_course_name, resolve_section_gpa, warm_caches
    from .planner_solver import Candidate, Requirement
except ImportError:  # pragma: no cover
    from course_restrictions import evaluate_eligibility
    from gpa import GpaResult, HistoryRow, fetch_course_history, normalize_course_name, resolve_section_gpa, warm_caches
    from planner_solver import Candidate, Requirement


CROSS_SCHOOL_PREFIXES = ("3T", "3N", "ZA")
LOOKBACK_YEARS = 3
MAX_PARALLEL = 4
CATALOG_CACHE_TTL_SECONDS = 24 * 60 * 60
MAX_CATALOG_CACHE_ENTRIES = 5000

_catalog_cache: dict[tuple[str, str], tuple[float, list[dict[str, Any]]]] = {}
_catalog_cache_lock = threading.Lock()


@dataclass(frozen=True)
class RequirementSpec:
    id: str
    title: str
    credits: int
    course_names: tuple[str, ...]
    required: bool = True
    # Restrict candidates to these department prefixes (course_no[:2]); empty = any.
    department_prefixes: tuple[str, ...] = ()
    # Credit pool: pick sections from several of the listed courses until this many credits.
    pool_credits: int | None = None


@dataclass
class CandidateBuild:
    requirements: list[Requirement] = field(default_factory=list)
    candidates: list[Candidate] = field(default_factory=list)
    # requirement_id -> why nothing came back (name unknown to myNTUST, rate limit…)
    notes: dict[str, str] = field(default_factory=dict)
    status: str = "found"  # found / not_enabled / rate_limited / error


_DAY_ORDER = "MTWRFSU"
_PERIOD_ORDER = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "A", "B", "C", "D"]


def _evict_expired_catalog(now: float) -> None:
    if len(_catalog_cache) < MAX_CATALOG_CACHE_ENTRIES:
        return
    for key in [key for key, (expires_at, _) in _catalog_cache.items() if expires_at <= now]:
        _catalog_cache.pop(key, None)
    if len(_catalog_cache) >= MAX_CATALOG_CACHE_ENTRIES:
        _catalog_cache.clear()


def clear_catalog_cache() -> None:
    """Clear the process-wide catalog cache (primarily useful for tests)."""
    with _catalog_cache_lock:
        _catalog_cache.clear()


def _cached_catalog(key: tuple[str, str]) -> list[dict[str, Any]] | None:
    now = time.time()
    with _catalog_cache_lock:
        entry = _catalog_cache.get(key)
        if entry and entry[0] > now:
            return entry[1]
        if entry:
            _catalog_cache.pop(key, None)
    return None


def _store_catalog(key: tuple[str, str], rows: list[dict[str, Any]]) -> None:
    now = time.time()
    with _catalog_cache_lock:
        _evict_expired_catalog(now)
        _catalog_cache[key] = (now + CATALOG_CACHE_TTL_SECONDS, rows)


def _slot_sort_key(slot: str) -> tuple[int, int]:
    """myNTUST lists "R10,R8,R9"; show and compare them in timetable order."""
    day = _DAY_ORDER.find(slot[:1]) if slot else 99
    period = slot[1:]
    return (day if day >= 0 else 99, _PERIOD_ORDER.index(period) if period in _PERIOD_ORDER else 99)


def _half(term: str) -> str:
    return term.strip()[-1:]


def _term_year(term: str) -> int:
    digits = "".join(ch for ch in term if ch.isdigit())
    return int(digits[:-1]) if len(digits) >= 2 else 0


def offered_in(plan_terms: list[str], semesters: list[int], newest_plan_year: int) -> tuple[str, ...]:
    """Plan terms whose half-year this section has run in during the look-back window."""
    halves = {
        str(s)[-1:] for s in semesters if newest_plan_year - (s // 10) <= LOOKBACK_YEARS + 1
    }
    return tuple(t for t in plan_terms if _half(t) in halves)


def build_candidates(
    specs: list[RequirementSpec],
    plan_terms: list[str],
    api_key: str,
    verify_ssl: bool,
    include_cross_school: bool = False,
    preferred_prefixes: tuple[str, ...] = (),
    *,
    fetch_catalog: Callable[[str, str], list[dict[str, Any]]] | None = None,
) -> CandidateBuild:
    out = CandidateBuild()
    if not api_key.strip():
        out.status = "not_enabled"
        out.requirements = [Requirement(s.id, s.title, s.credits, s.required, s.pool_credits) for s in specs]
        return out
    newest_year = max((_term_year(t) for t in plan_terms), default=0)
    normalized_preferred_prefixes = {prefix.strip().upper() for prefix in preferred_prefixes if prefix.strip()}

    names = list(dict.fromkeys(normalize_course_name(n) for s in specs for n in s.course_names if n.strip()))
    warm_caches([], names)
    with ThreadPoolExecutor(max_workers=min(MAX_PARALLEL, max(1, len(names)))) as pool:
        histories = dict(zip(names, pool.map(lambda n: fetch_course_history(n, api_key, verify_ssl), names)))

    grade_codes = list(
        dict.fromkeys(
            row.course_no.strip().upper()
            for history in histories.values()
            if history
            for row in history
            if row.course_no.strip()
        )
    )
    warm_caches(grade_codes, [])

    for spec in specs:
        out.requirements.append(Requirement(spec.id, spec.title, spec.credits, spec.required, spec.pool_credits))
        if spec.pool_credits and not spec.course_names:
            out.notes[spec.id] = "學分池只有課碼前綴、沒有課名清單，無法自動排；到課程查詢挑課後加進待修清單"
            continue
        rows: list[HistoryRow] = []
        missing = False
        for name in spec.course_names:
            hist = histories.get(normalize_course_name(name))
            if hist is None:
                missing = True
                continue
            rows.extend(hist)
        if not rows:
            out.notes[spec.id] = "myNTUST 歷史查詢失敗（限流或網路），稍後重跑" if missing else "myNTUST 查不到這個課名"
            if missing:
                out.status = "rate_limited"
            continue
        # group by code + teacher, keep the latest offering for timetable
        groups: dict[tuple[str, str], list[HistoryRow]] = {}
        for row in rows:
            prefix = row.course_no[:2]
            if not include_cross_school and prefix in CROSS_SCHOOL_PREFIXES:
                continue
            if spec.department_prefixes and prefix not in spec.department_prefixes:
                continue
            # 專題、實習常沒有授課老師（"未 定"）；留著，老師顯示空白。
            lecturer = "" if row.lecturer.replace(" ", "") in {"", "未定"} else row.lecturer
            # A 1-credit micro-course with the same title (e.g. 會計學 BAG005301) does not satisfy a 3-credit requirement.
            min_credit = 3 if spec.pool_credits else spec.credits
            if row.credit is not None and min_credit and row.credit < min_credit:
                continue
            groups.setdefault((row.course_no, lecturer), []).append(row)
        if not groups:
            out.notes[spec.id] = "歷史開課都被系所或跨校條件排除"
            continue
        for (code, teacher), items in groups.items():
            latest = max(items, key=lambda r: r.semester)
            terms = offered_in(plan_terms, [r.semester for r in items], newest_year)
            if not terms:
                continue
            slots = tuple(sorted((s.strip().upper() for s in latest.node.split(",") if s.strip()), key=_slot_sort_key))
            campus = "華夏" if "華夏" in latest.classroom else ""
            out.candidates.append(
                Candidate(
                    id=f"{spec.id}:{code}:{teacher}",
                    requirement_id=spec.id,
                    course_no=code,
                    name=latest.course_name,
                    teacher=teacher,
                    credits=latest.credit or spec.credits,
                    slots=slots,
                    offered_terms=terms,
                    campus=campus,
                    source_semester=str(latest.semester),
                    group=normalize_course_name(latest.course_name),
                )
            )
    if fetch_catalog and out.candidates:
        catalog_pairs = sorted(
            {
                (cand.source_semester, cand.course_no.strip()[:2].upper())
                for cand in out.candidates
            }
        )

        def _fetch_catalog_pair(pair: tuple[str, str]) -> tuple[tuple[str, str], list[dict[str, Any]] | None, bool]:
            cached = _cached_catalog(pair)
            if cached is not None:
                return pair, cached, False
            try:
                rows = fetch_catalog(pair[0], pair[1])
                if not isinstance(rows, list):
                    raise RuntimeError("課程查詢系統回傳格式不是課程清單。")
            except (requests.RequestException, RuntimeError):
                return pair, None, True
            _store_catalog(pair, rows)
            return pair, rows, False

        catalog_rows: dict[tuple[str, str], list[dict[str, Any]]] = {}
        failed_pairs: list[tuple[str, str]] = []
        with ThreadPoolExecutor(max_workers=min(MAX_PARALLEL, len(catalog_pairs))) as pool:
            for pair, rows, failed in pool.map(_fetch_catalog_pair, catalog_pairs):
                if failed:
                    failed_pairs.append(pair)
                elif rows is not None:
                    catalog_rows[pair] = rows

        if failed_pairs:
            out.notes["__catalog__"] = "官方課程查詢失敗：" + "、".join(
                f"{semester}/{prefix}" for semester, prefix in failed_pairs
            )

        by_catalog_course: dict[tuple[str, str], str] = {}
        for pair, rows in catalog_rows.items():
            for row in rows:
                if not isinstance(row, dict):
                    continue
                course_no = str(row.get("CourseNo") or "").strip().upper()
                if course_no:
                    by_catalog_course[(pair[0], course_no)] = str(row.get("Contents") or "")

        enriched_catalog: list[Candidate] = []
        original_counts: dict[str, int] = {}
        remaining_counts: dict[str, int] = {}
        identity_prefixes = normalized_preferred_prefixes
        for cand in out.candidates:
            original_counts[cand.requirement_id] = original_counts.get(cand.requirement_id, 0) + 1
            key = (cand.source_semester, cand.course_no.strip().upper())
            if key not in by_catalog_course:
                eligibility = "unknown"
                contents = ""
            else:
                contents = by_catalog_course[key]
                eligibility = evaluate_eligibility(
                    cand.course_no,
                    contents,
                    identity_prefixes,
                    "addDrop",
                ).level
            if eligibility == "blocked":
                continue
            remaining_counts[cand.requirement_id] = remaining_counts.get(cand.requirement_id, 0) + 1
            enriched_catalog.append(Candidate(**{**cand.__dict__, "contents": contents, "eligibility": eligibility}))
        out.candidates = enriched_catalog
        for requirement_id, count in original_counts.items():
            if count > 0 and remaining_counts.get(requirement_id, 0) == 0:
                out.notes[requirement_id] = "歷史開課全部資格不符（限系所），排不進"

    section_keys = [(cand.requirement_id, cand.course_no, cand.teacher) for cand in out.candidates]

    # GPA per candidate (cached per code in gpa.py; the history is already cached)
    def _gpa(key: tuple[str, str, str]):
        _rid, code, teacher = key
        cand = next(c for c in out.candidates if c.course_no == code and c.teacher == teacher and c.requirement_id == _rid)
        if not teacher:
            return GpaResult(None, "no_data")
        return resolve_section_gpa(code, cand.name, teacher, api_key, verify_ssl)

    if out.candidates:
        with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as pool:
            results = list(pool.map(_gpa, section_keys))
        enriched: list[Candidate] = []
        for cand, result in zip(out.candidates, results):
            gpa = result.gpa if result.status == "found" else None
            students = result.students if result.status == "found" else None
            # No grade record for this teacher is a mild risk; a department the student does not belong to
            # (e.g. 管理學士班 sections marked 限管理學士班) is a bigger one — usually not selectable at all.
            risk = 0 if gpa is not None else 1
            if normalized_preferred_prefixes and cand.course_no.strip()[:2].upper() not in normalized_preferred_prefixes:
                risk += 3
            if cand.eligibility == "signature":
                risk += 2
            enriched.append(
                Candidate(**{**cand.__dict__, "gpa": gpa, "students": students, "risk": risk})
            )
            if result.status == "rate_limited":
                out.status = "rate_limited"
        out.candidates = enriched
    return out


def candidate_to_dict(cand: Candidate) -> dict[str, Any]:
    return {
        "candidate_id": cand.id,
        "requirement_id": cand.requirement_id,
        "course_no": cand.course_no,
        "name": cand.name,
        "teacher": cand.teacher,
        "credits": cand.credits,
        "slots": list(cand.slots),
        "offered_terms": list(cand.offered_terms),
        "gpa": cand.gpa,
        "students": cand.students,
        "campus": cand.campus,
        "risk": cand.risk,
        "source_semester": cand.source_semester,
        "contents": cand.contents,
        "eligibility": cand.eligibility,
    }
