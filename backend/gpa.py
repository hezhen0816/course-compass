from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

import requests

try:
    from . import myntust_cache
except ImportError:  # pragma: no cover
    import myntust_cache


GPA_GRADE_API_URL = "https://myntust.com/api/v1/grades"
COURSE_HISTORY_API_URL = "https://myntust.com/api/v1/courses"

# The API is documented as 120 requests/minute and has no batch endpoint, so a
# 30-row search would spend 30 calls of that budget every time. GPA per course is
# the same for every user, so cache it process-wide for a day and fetch the
# misses with a small pool.
CACHE_TTL_SECONDS = 24 * 60 * 60
MAX_CACHE_ENTRIES = 5000
MAX_PARALLEL_REQUESTS = 4
REQUEST_TIMEOUT = 10
# Pages of the name search to walk when building a course's teaching history.
MAX_HISTORY_PAGES = 3
# How many other sections by the same teacher to try before giving up.
MAX_ALTERNATE_SECTIONS = 3

# myNTUST allows 120 requests/minute. A planner run can need 150+, so pace them
# instead of tripping the 429 (which pauses everything and loses data).
REQUESTS_PER_MINUTE = 100
_request_times: list[float] = []

_cache: dict[str, tuple[float, "GradeRecord"]] = {}
_history_cache: dict[str, tuple[float, list["HistoryRow"]]] = {}
_cache_lock = threading.Lock()
# When the API answers 429 we stop the rest of the batch until this timestamp:
# hammering a rate-limited endpoint is what gets a token blocked.
_rate_limited_until = 0.0


@dataclass(frozen=True)
class GradeRecord:
    """One answer of /grades/{course_no}: the latest semester that code has grades for."""

    gpa: float | None
    status: str  # found / no_data / error / not_enabled / rate_limited
    semester: int | None = None
    students: int | None = None
    # Grade letter -> head count, as myNTUST reports it (A+ … E, X).
    distribution: dict[str, int] | None = None


@dataclass(frozen=True)
class HistoryRow:
    course_no: str
    course_name: str
    lecturer: str
    semester: int
    node: str = ""  # "M2,M3,M4"; the multi-semester planner needs it
    credit: int | None = None
    classroom: str = ""


@dataclass(frozen=True)
class GpaResult:
    """GPA attributed to a section (course_no + teacher), not just a course code.

    ``status`` adds ``other_teacher`` to the GradeRecord statuses: the code has a
    GPA, but in that semester it was taught by ``teacher`` (someone else), and no
    section by the requested teacher has grades.
    """

    gpa: float | None
    status: str
    semester: int | None = None
    students: int | None = None
    teacher: str | None = None
    course_no: str | None = None

    def as_fields(self) -> dict[str, Any]:
        return {
            "gpa": self.gpa,
            "gpa_status": self.status,
            "gpa_semester": self.semester,
            "gpa_students": self.students,
            "gpa_teacher": self.teacher,
            "gpa_course_no": self.course_no,
        }


def as_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def as_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def normalize_course_name(name: str) -> str:
    return name.replace("（", "(").replace("）", ")").replace(" ", "").replace("　", "").strip()


def normalize_teacher(name: str) -> str:
    return name.replace(" ", "").replace("　", "").strip()


def same_teacher(official: str, lecturer: str) -> bool:
    """Co-taught classes list several names: the catalog uses "、", myNTUST uses ","."""
    official_names = {n for n in normalize_teacher(official).replace(",", "、").split("、") if n}
    lecturer_names = {n for n in normalize_teacher(lecturer).replace(",", "、").split("、") if n}
    if not official_names or not lecturer_names:
        return False
    return bool(official_names & lecturer_names)


def clear_cache() -> None:
    global _rate_limited_until
    with _cache_lock:
        _cache.clear()
        _history_cache.clear()
        _request_times.clear()
        _rate_limited_until = 0.0


def _evict_expired(store: dict[str, tuple[float, Any]], now: float) -> None:
    if len(store) < MAX_CACHE_ENTRIES:
        return
    for key in [k for k, (expires, _) in store.items() if expires <= now]:
        store.pop(key, None)
    if len(store) >= MAX_CACHE_ENTRIES:
        store.clear()


def _cached_grade(course_no: str) -> GradeRecord | None:
    now = time.time()
    with _cache_lock:
        entry = _cache.get(course_no)
        if entry and entry[0] > now:
            return entry[1]
        if entry:
            _cache.pop(course_no, None)
    return None


def _load_persistent_grade(course_no: str) -> GradeRecord | None:
    try:
        records = myntust_cache.load_grades([course_no])
        record = records.get(course_no)
        if record is not None and record.status in ("found", "no_data"):
            _store_grade(course_no, record)
            return record
    except Exception:  # pragma: no cover - the cache client is best-effort by design
        return None
    return None


def _store_grade(course_no: str, record: GradeRecord) -> None:
    # "error" is transient (network, 5xx, rate limit): caching it would hide the
    # real value for a day.
    if record.status in ("error", "rate_limited"):
        return
    now = time.time()
    with _cache_lock:
        _evict_expired(_cache, now)
        _cache[course_no] = (now + CACHE_TTL_SECONDS, record)


def _cached_history(name: str) -> list[HistoryRow] | None:
    now = time.time()
    with _cache_lock:
        entry = _history_cache.get(name)
        if entry and entry[0] > now:
            return entry[1]
        if entry:
            _history_cache.pop(name, None)
    return None


def _load_persistent_history(name: str) -> list[HistoryRow] | None:
    try:
        histories = myntust_cache.load_histories([name])
        if name in histories:
            rows = histories[name]
            _store_history(name, rows)
            return rows
    except Exception:  # pragma: no cover - the cache client is best-effort by design
        return None
    return None


def _store_history(name: str, rows: list[HistoryRow]) -> None:
    now = time.time()
    with _cache_lock:
        _evict_expired(_history_cache, now)
        _history_cache[name] = (now + CACHE_TTL_SECONDS, rows)


def warm_caches(course_nos: list[str], names: list[str]) -> None:
    """Warm the process cache from Supabase in one batch per cache kind."""
    try:
        for course_no, record in myntust_cache.load_grades(course_nos).items():
            if record.status in ("found", "no_data"):
                _store_grade(course_no, record)
        for name, rows in myntust_cache.load_histories(names).items():
            _store_history(name, rows)
    except Exception:  # pragma: no cover - the cache client is best-effort by design
        # A persistent cache outage must never prevent a myNTUST lookup.
        return


def _persist_grade(course_no: str, record: GradeRecord) -> None:
    try:
        myntust_cache.save_grade(course_no, record)
    except Exception:  # pragma: no cover - the cache client is best-effort by design
        return


def _persist_history(name: str, rows: list[HistoryRow]) -> None:
    try:
        myntust_cache.save_history(name, rows)
    except Exception:  # pragma: no cover - the cache client is best-effort by design
        return


def _retry_after_seconds(response: requests.Response) -> float:
    try:
        return max(1.0, min(300.0, float(response.headers.get("Retry-After", "60"))))
    except (TypeError, ValueError):
        return 60.0


def _rate_limited() -> bool:
    with _cache_lock:
        return _rate_limited_until > time.time()


def _note_rate_limit(response: requests.Response) -> None:
    global _rate_limited_until
    with _cache_lock:
        _rate_limited_until = time.time() + _retry_after_seconds(response)


MAX_WAIT_SECONDS = 120.0


def _throttle() -> bool:
    """Block until another request fits under REQUESTS_PER_MINUTE (sliding 60 s window)
    and any 429 pause has passed. False when that would take longer than MAX_WAIT_SECONDS."""
    waited = 0.0
    while True:
        with _cache_lock:
            now = time.time()
            while _request_times and _request_times[0] <= now - 60:
                _request_times.pop(0)
            paused = _rate_limited_until - now
            if paused <= 0 and len(_request_times) < REQUESTS_PER_MINUTE:
                _request_times.append(now)
                return True
            wait = paused if paused > 0 else _request_times[0] + 60 - now
        wait = max(0.05, wait)
        if waited + wait > MAX_WAIT_SECONDS:
            return False
        time.sleep(wait)
        waited += wait


def _headers(api_key: str) -> dict[str, str]:
    return {"Accept": "application/json", "Authorization": f"Bearer {api_key.strip()}"}


def fetch_grade_record(course_no: str, api_key: str, verify_ssl: bool) -> GradeRecord:
    normalized_course_no = course_no.strip().upper()
    if not normalized_course_no or not api_key.strip():
        return GradeRecord(None, "not_enabled")

    hit = _cached_grade(normalized_course_no)
    if hit is not None:
        return hit
    hit = _load_persistent_grade(normalized_course_no)
    if hit is not None:
        return hit

    try:
        response = None
        for _attempt in range(2):
            if not _throttle():
                return GradeRecord(None, "rate_limited")
            response = requests.get(
                f"{GPA_GRADE_API_URL}/{normalized_course_no}",
                headers=_headers(api_key),
                timeout=REQUEST_TIMEOUT,
                verify=verify_ssl,
            )
            if response.status_code != 429:
                break
            _note_rate_limit(response)  # wait it out once, then give up
        assert response is not None
        if response.status_code == 429:
            return GradeRecord(None, "rate_limited")
        if response.status_code == 404:
            record = GradeRecord(None, "no_data")
            _store_grade(normalized_course_no, record)
            _persist_grade(normalized_course_no, record)
            return record
        if response.status_code >= 400:
            return GradeRecord(None, "error")
        payload = response.json()
    except (ValueError, requests.RequestException):
        return GradeRecord(None, "error")

    data = payload.get("data") if isinstance(payload, dict) and payload.get("success") is not False else None
    gpa = as_float(data.get("gpa")) if isinstance(data, dict) else None
    if gpa is None:
        record = GradeRecord(None, "no_data")
    else:
        raw_distribution = data.get("grade_distribution")
        distribution = None
        if isinstance(raw_distribution, dict):
            distribution = {str(k): n for k, v in raw_distribution.items() if (n := as_int(v)) is not None}
        record = GradeRecord(gpa, "found", as_int(data.get("semester")), as_int(data.get("total_students")), distribution)
    _store_grade(normalized_course_no, record)
    _persist_grade(normalized_course_no, record)
    return record


def fetch_course_gpa(course_no: str, api_key: str, verify_ssl: bool) -> tuple[float | None, str]:
    """GPA for one course code. Statuses: found / no_data / error / not_enabled / rate_limited."""
    record = fetch_grade_record(course_no, api_key, verify_ssl)
    return record.gpa, record.status


def fetch_course_gpas(
    course_nos: list[str], api_key: str, verify_ssl: bool
) -> dict[str, tuple[float | None, str]]:
    """GPA for many course codes: cache hits are free, misses go out a few at a time.

    Deduplicates course codes so repeated sections cost one request, and stops
    early once the API reports a rate limit (remaining codes come back
    "rate_limited" rather than adding to the flood).
    """
    unique = list(dict.fromkeys(c.strip().upper() for c in course_nos if c and c.strip()))
    if not unique or not api_key.strip():
        return {c: (None, "not_enabled") for c in unique}

    results: dict[str, tuple[float | None, str]] = {}
    misses: list[str] = []
    for course_no in unique:
        hit = _cached_grade(course_no)
        if hit is not None:
            results[course_no] = (hit.gpa, hit.status)
        else:
            misses.append(course_no)

    if misses:
        workers = min(MAX_PARALLEL_REQUESTS, len(misses))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for course_no, outcome in zip(
                misses, pool.map(lambda c: fetch_course_gpa(c, api_key, verify_ssl), misses)
            ):
                results[course_no] = outcome
    return results


def fetch_course_history(course_name: str, api_key: str, verify_ssl: bool) -> list[HistoryRow] | None:
    """Every (course_no, lecturer, semester) myNTUST knows for this exact course name.

    None means the lookup could not be completed (network, 5xx, rate limit) and
    nothing is cached; an empty list means the name is unknown to myNTUST.
    """
    name = normalize_course_name(course_name)
    if not name or not api_key.strip():
        return None
    hit = _cached_history(name)
    if hit is not None:
        return hit
    hit = _load_persistent_history(name)
    if hit is not None:
        return hit

    rows: list[HistoryRow] = []
    page = 1
    while page <= MAX_HISTORY_PAGES:
        try:
            response = None
            for _attempt in range(2):
                if not _throttle():
                    return None
                response = requests.get(
                    COURSE_HISTORY_API_URL,
                    params={"keyword": name, "page": page},
                    headers=_headers(api_key),
                    timeout=REQUEST_TIMEOUT,
                    verify=verify_ssl,
                )
                if response.status_code != 429:
                    break
                _note_rate_limit(response)
            assert response is not None
            if response.status_code == 429:
                return None
            if response.status_code == 404:
                break
            if response.status_code >= 400:
                return None
            payload = response.json()
        except (ValueError, requests.RequestException):
            return None
        if not isinstance(payload, dict) or payload.get("success") is False:
            break
        for item in payload.get("data") or []:
            if not isinstance(item, dict):
                continue
            if normalize_course_name(str(item.get("course_name") or "")) != name:
                continue
            semester = as_int(item.get("semester"))
            course_no = str(item.get("course_no") or "").strip().upper()
            if semester is None or not course_no:
                continue
            rows.append(
                HistoryRow(
                    course_no,
                    name,
                    str(item.get("lecturer") or "").strip(),
                    semester,
                    str(item.get("node") or "").strip(),
                    as_int(item.get("credit")),
                    str(item.get("classroom_no") or "").strip(),
                )
            )
        pagination = payload.get("pagination")
        if not isinstance(pagination, dict) or not pagination.get("has_next"):
            break
        page += 1

    _store_history(name, rows)
    _persist_history(name, rows)
    return rows


def _lecturer_of(history: list[HistoryRow], course_no: str, semester: int | None) -> str | None:
    if semester is None:
        return None
    for row in history:
        if row.course_no == course_no and row.semester == semester:
            return row.lecturer or None
    return None


def resolve_section_gpa(
    course_no: str, course_name: str, teacher: str, api_key: str, verify_ssl: bool
) -> GpaResult:
    """GPA that actually belongs to this teacher's class.

    /grades/{code} answers with the latest semester that code has grades for, but
    a code is reused every year and the teacher changes, so a bare code lookup
    can attribute someone else's grades to this section. Cross-check the grade's
    semester against the teaching history; when it points at a different
    teacher, look for another section the requested teacher taught instead.
    """
    code = course_no.strip().upper()
    own = fetch_grade_record(code, api_key, verify_ssl)
    if own.status in ("not_enabled", "rate_limited"):
        return GpaResult(None, own.status)

    history = fetch_course_history(course_name, api_key, verify_ssl) if teacher.strip() else None
    if history is None:
        # No way to verify: keep the code-level answer, teacher unknown.
        return GpaResult(own.gpa, own.status, own.semester, own.students, None, code if own.gpa is not None else None)

    lecturer = _lecturer_of(history, code, own.semester) if own.status == "found" else None
    if own.status == "found" and (lecturer is None or same_teacher(teacher, lecturer)):
        return GpaResult(own.gpa, "found", own.semester, own.students, lecturer, code)

    # Other codes this teacher taught under the same name, newest first.
    latest: dict[str, int] = {}
    for row in history:
        if row.course_no != code and same_teacher(teacher, row.lecturer):
            latest[row.course_no] = max(latest.get(row.course_no, 0), row.semester)
    for alt in sorted(latest, key=lambda c: -latest[c])[:MAX_ALTERNATE_SECTIONS]:
        record = fetch_grade_record(alt, api_key, verify_ssl)
        if record.status == "rate_limited":
            break
        if record.status != "found":
            continue
        alt_lecturer = _lecturer_of(history, alt, record.semester)
        if alt_lecturer is None or same_teacher(teacher, alt_lecturer):
            return GpaResult(record.gpa, "found", record.semester, record.students, alt_lecturer or teacher, alt)

    if own.status == "found":
        return GpaResult(own.gpa, "other_teacher", own.semester, own.students, lecturer, code)
    return GpaResult(None, own.status)


def fetch_section_gpas(
    sections: list[tuple[str, str, str]], api_key: str, verify_ssl: bool
) -> dict[str, GpaResult]:
    """resolve_section_gpa for many (course_no, course_name, teacher) rows, keyed by course_no."""
    unique: dict[str, tuple[str, str]] = {}
    for course_no, course_name, teacher in sections:
        code = (course_no or "").strip().upper()
        if code and code not in unique:
            unique[code] = (course_name or "", teacher or "")
    if not unique:
        return {}
    if not api_key.strip():
        return {code: GpaResult(None, "not_enabled") for code in unique}

    codes = list(unique)
    workers = min(MAX_PARALLEL_REQUESTS, len(codes))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        outcomes = pool.map(
            lambda code: resolve_section_gpa(code, unique[code][0], unique[code][1], api_key, verify_ssl), codes
        )
        return dict(zip(codes, outcomes))


@dataclass(frozen=True)
class GpaHistoryRow:
    semester: int
    course_no: str
    teacher: str
    gpa: float | None
    students: int | None
    distribution: dict[str, int] | None

    def as_fields(self) -> dict[str, Any]:
        return {
            "semester": self.semester,
            "course_no": self.course_no,
            "teacher": self.teacher,
            "gpa": self.gpa,
            "students": self.students,
            "distribution": self.distribution,
        }


def fetch_gpa_history(course_name: str, api_key: str, verify_ssl: bool) -> tuple[list[GpaHistoryRow] | None, str]:
    """Every class ever offered under this exact name, newest first, with grades where myNTUST has them.

    A code's grade record only describes its latest graded semester, so the
    number is attached to that row alone; the code's other semesters stay empty
    rather than borrowing it.
    """
    if not api_key.strip():
        return None, "not_enabled"
    history = fetch_course_history(course_name, api_key, verify_ssl)
    if history is None:
        return None, "rate_limited" if _rate_limited() else "error"
    codes = list(dict.fromkeys(row.course_no for row in history))
    records: dict[str, GradeRecord] = {}
    if codes:
        workers = min(MAX_PARALLEL_REQUESTS, len(codes))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            records = dict(zip(codes, pool.map(lambda c: fetch_grade_record(c, api_key, verify_ssl), codes)))
    rows: list[GpaHistoryRow] = []
    for row in sorted(history, key=lambda r: (-r.semester, r.course_no)):
        record = records.get(row.course_no)
        graded = record is not None and record.status == "found" and record.semester == row.semester
        rows.append(
            GpaHistoryRow(
                row.semester,
                row.course_no,
                row.lecturer,
                record.gpa if graded and record else None,
                record.students if graded and record else None,
                record.distribution if graded and record else None,
            )
        )
    status = "rate_limited" if any(r.status == "rate_limited" for r in records.values()) else "found"
    return rows, status
