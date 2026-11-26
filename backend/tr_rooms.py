from __future__ import annotations

import json
import logging
import os
import re
import threading
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import requests

try:
    from .config import CLASS_PERIODS, DAY_CODES, DAY_NAMES, DEFAULT_TIMEOUT, QUERY_COURSE_API_URL, SEMESTERS_INFO_URL, TAIPEI
    from .models import TRRoomMeeting
    from .ntust_common import normalize
    from .monitor.semester import get_default_semester
    from .time_utils import now
except ImportError:  # pragma: no cover
    from config import CLASS_PERIODS, DAY_CODES, DAY_NAMES, DEFAULT_TIMEOUT, QUERY_COURSE_API_URL, SEMESTERS_INFO_URL, TAIPEI
    from models import TRRoomMeeting
    from ntust_common import normalize
    from monitor.semester import get_default_semester
    from time_utils import now

logger = logging.getLogger(__name__)
ROOM_RE = re.compile(r"\bTR-\d+(?:-\d+)?\b", re.IGNORECASE)
# The unfiltered semester course list is ~2 MB and the school API routinely
# takes 60s+ to produce it in the evening; the default 30s timeout aborts it.
FULL_COURSE_LIST_TIMEOUT = max(DEFAULT_TIMEOUT, 150)

def query_course_payload(semester: str, *, include_cross_school: bool = False) -> dict[str, Any]:
    """Payload for the school's course query API.

    OnleyNTUST=1 (sic, the API's own spelling) limits results to NTUST's own
    sections; the official query page includes 台大/師大 cross-school courses
    by default, so callers can opt in with include_cross_school.
    """
    return {
        "Semester": semester,
        "CourseNo": "",
        "CourseName": "",
        "CourseTeacher": "",
        "Dimension": "",
        "CourseNotes": "",
        # No campus filter: "Main_Campus" silently dropped 華夏校區 sections
        # (e.g. BA305A001/2 統計學) that the official query page does show.
        "CampusNotes": "",
        "ForeignLanguage": 0,
        "OnlyIntensive": 0,
        "OnlyGeneral": 0,
        "OnleyNTUST": 0 if include_cross_school else 1,
        "OnlyMaster": 0,
        "OnlyUnderGraduate": 0,
        "OnlyNode": 0,
        "Language": "zh",
    }


def fetch_current_query_semester(verify_ssl: bool) -> str:
    """目前學期。實作共用 backend/monitor/semester.py：那份有學期格式驗證、
    候選清單回退與日期兜底，這裡原本的簡化版都沒有（取不到就直接丟例外）。
    """
    return get_default_semester(verify_ssl=verify_ssl)


# The school API rejects requests without a browser-like Origin/Referer.
QUERY_COURSE_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json; charset=utf-8",
    "Origin": "https://querycourse.ntust.edu.tw",
    "Referer": "https://querycourse.ntust.edu.tw/querycourse/",
    "User-Agent": "Mozilla/5.0",
}


COURSE_CACHE_TTL_SECONDS = 6 * 3600
REFRESH_MIN_AGE_SECONDS = 300
_SEMESTER_RE = re.compile(r"^[0-9A-Za-z_-]{1,16}$")
_CACHE_FILE_PREFIX = "tr_courses_"
_DEFAULT_CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache"


class _CacheEntry:
    __slots__ = ("semester", "fetched_at", "courses")

    def __init__(self, semester: str, fetched_at: datetime, courses: list[dict[str, Any]]):
        self.semester = semester
        self.fetched_at = fetched_at
        self.courses = courses


class _Flight:
    """One in-flight school fetch; blocked callers wait on `done`."""

    def __init__(self) -> None:
        self.done = threading.Event()
        self.leader = False
        self.error: BaseException | None = None
        self.courses: list[dict[str, Any]] | None = None


_cache_lock = threading.Lock()
# Keep a single semester in memory: `semester` is caller-controlled, so an
# unbounded dict would let anyone grow the process by ~2 MB per key.
_cache_entry: _CacheEntry | None = None
_inflight: dict[str, _Flight] = {}


def _validate_semester(semester: str) -> str:
    if not isinstance(semester, str) or not _SEMESTER_RE.fullmatch(semester):
        raise RuntimeError("學期格式不正確。")
    return semester


def _cache_dir() -> Path:
    override = os.environ.get("TR_COURSE_CACHE_DIR")
    return Path(override) if override else _DEFAULT_CACHE_DIR


def _cache_file(semester: str) -> Path:
    return _cache_dir() / f"{_CACHE_FILE_PREFIX}{_validate_semester(semester)}.json"


def _load_from_disk(semester: str) -> _CacheEntry | None:
    try:
        payload = json.loads(_cache_file(semester).read_text(encoding="utf-8"))
        courses = payload["courses"]
        fetched_at = datetime.fromisoformat(payload["fetched_at"])
        if payload.get("semester") != semester or not isinstance(courses, list):
            return None
        if fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=TAIPEI)
        return _CacheEntry(semester, fetched_at, courses)
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _write_to_disk(entry: _CacheEntry) -> None:
    try:
        target = _cache_file(entry.semester)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(f"{target.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        tmp.write_text(
            json.dumps(
                {"semester": entry.semester, "fetched_at": entry.fetched_at.isoformat(), "courses": entry.courses},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        os.replace(tmp, target)
        for other in target.parent.glob(f"{_CACHE_FILE_PREFIX}*.json"):
            if other != target:
                other.unlink(missing_ok=True)
    except Exception:
        logger.exception("無法寫入課程清單磁碟快取")


def _fetch_full_course_list(semester: str, verify_ssl: bool) -> list[dict[str, Any]]:
    response = requests.post(
        QUERY_COURSE_API_URL,
        json=query_course_payload(semester),
        headers=QUERY_COURSE_HEADERS,
        timeout=FULL_COURSE_LIST_TIMEOUT,
        verify=verify_ssl,
    )
    response.raise_for_status()
    courses = response.json()
    if not isinstance(courses, list):
        raise RuntimeError("課程查詢系統回傳格式不是課程清單。")
    return courses


def _run_flight(semester: str, verify_ssl: bool, flight: _Flight) -> None:
    global _cache_entry
    try:
        courses = _fetch_full_course_list(semester, verify_ssl)
        entry = _CacheEntry(semester, now(), courses)
        _write_to_disk(entry)
        with _cache_lock:
            _cache_entry = entry
        flight.courses = courses
    except BaseException as exc:
        flight.error = exc
    finally:
        with _cache_lock:
            if _inflight.get(semester) is flight:
                del _inflight[semester]
        flight.done.set()


def _start_background_refresh_locked(semester: str, verify_ssl: bool) -> None:
    """Caller holds _cache_lock. No-op when a fetch for the semester is already running."""
    if semester in _inflight:
        return
    flight = _Flight()
    _inflight[semester] = flight

    def worker() -> None:
        _run_flight(semester, verify_ssl, flight)
        if flight.error is not None:
            logger.warning("背景更新課程清單失敗，繼續使用舊資料：%r", flight.error)

    threading.Thread(target=worker, name="tr-course-refresh", daemon=True).start()


def _get_entry(semester: str, refresh: bool, verify_ssl: bool) -> _CacheEntry | _Flight:
    """Return cached entry (possibly stale, background refresh kicked off) or a flight to wait on."""
    global _cache_entry
    with _cache_lock:
        entry = _cache_entry if _cache_entry and _cache_entry.semester == semester else None
        if entry is None:
            entry = _load_from_disk(semester)
            if entry is not None:
                _cache_entry = entry
        if entry is not None:
            age = (now() - entry.fetched_at).total_seconds()
            limit = REFRESH_MIN_AGE_SECONDS if refresh else COURSE_CACHE_TTL_SECONDS
            if age >= limit:
                _start_background_refresh_locked(semester, verify_ssl)
            return entry
        flight = _inflight.get(semester)
        if flight is not None:
            return flight
        flight = _Flight()
        flight.leader = True
        _inflight[semester] = flight
        return flight


def _resolve_entry(semester: str, refresh: bool, verify_ssl: bool) -> _CacheEntry:
    global _cache_entry
    _validate_semester(semester)
    while True:
        got = _get_entry(semester, refresh, verify_ssl)
        if isinstance(got, _CacheEntry):
            return got
        if got.leader:
            got.leader = False
            _run_flight(semester, verify_ssl, got)
        else:
            got.done.wait()
        if got.error is not None:
            raise got.error
        with _cache_lock:
            if _cache_entry is not None and _cache_entry.semester == semester:
                return _cache_entry
        # Entry was replaced by another semester in the meantime; retry.


def fetch_query_courses(semester: str, refresh: bool, verify_ssl: bool) -> list[dict[str, Any]]:
    """Full semester course list, stale-while-revalidate.

    Fresh for 6 h; older data is returned immediately while a daemon thread
    refreshes it. Only a cold start (no memory, no disk file) blocks, and
    concurrent blockers share one school request. ``refresh`` only triggers a
    background refresh when the data is older than 5 minutes.
    """
    return _resolve_entry(semester, refresh, verify_ssl).courses


_meetings_memo: tuple[list[dict[str, Any]], list[TRRoomMeeting]] | None = None


def get_tr_meetings(courses: list[dict[str, Any]]) -> list[TRRoomMeeting]:
    """build_tr_meetings memoized by list identity (one slot; the memo holds the list so ids are not reused)."""
    global _meetings_memo
    with _cache_lock:
        memo = _meetings_memo
        if memo is not None and memo[0] is courses:
            return memo[1]
    meetings = build_tr_meetings(courses)
    with _cache_lock:
        _meetings_memo = (courses, meetings)
    return meetings


def prewarm_course_cache(verify_ssl: bool) -> None:
    """Load the current semester's course list in a daemon thread; never raises."""
    if os.environ.get("TR_COURSE_PREWARM") == "0":
        return

    def worker() -> None:
        try:
            semester = fetch_current_query_semester(verify_ssl=verify_ssl)
            fetch_query_courses(semester, False, verify_ssl)
        except Exception:
            logger.exception("啟動預熱課程清單失敗")

    threading.Thread(target=worker, name="tr-course-prewarm", daemon=True).start()


def _reset_course_cache_for_tests() -> None:
    global _cache_entry, _meetings_memo
    with _cache_lock:
        _cache_entry = None
        _meetings_memo = None
        _inflight.clear()


def fetch_query_courses_filtered(
    semester: str,
    *,
    course_no: str = "",
    course_name: str = "",
    teacher: str = "",
    dimension: str = "",
    only_general: bool = False,
    only_undergraduate: bool = False,
    only_master: bool = False,
    verify_ssl: bool,
    include_cross_school: bool = False,
    session: requests.Session | None = None,
    timeout: float | None = None,
) -> list[dict[str, Any]]:
    """Filtered course query (no cache). Single transport for Compass and the monitor worker.

    ``session`` lets the monitor reuse its per-user proxied session; ``timeout``
    lets it fail fast (it polls every few seconds and treats a timeout as one
    missed check, not an error).

    課名、課號、教師都是部分比對，而且都能單獨使用（2026-09-17 實測：只填教師「曾」回 34 門）。
    通識、向度與學制學校端就篩得掉，不必整包撈回來自己過濾；節次則不行——`OnlyNode`
    與 `CampusNotes` 實測完全無效（照樣回全部 2190 門），所以節次一律由呼叫端本機篩。
    """
    payload = query_course_payload(semester, include_cross_school=include_cross_school)
    payload["CourseNo"] = course_no
    payload["CourseName"] = course_name
    payload["CourseTeacher"] = teacher
    payload["Dimension"] = dimension
    payload["OnlyGeneral"] = 1 if only_general else 0
    payload["OnlyUnderGraduate"] = 1 if only_undergraduate else 0
    payload["OnlyMaster"] = 1 if only_master else 0
    response = (session or requests).post(
        QUERY_COURSE_API_URL,
        json=payload,
        headers=QUERY_COURSE_HEADERS,
        timeout=timeout or DEFAULT_TIMEOUT,
        verify=verify_ssl,
    )
    response.raise_for_status()
    courses = response.json()
    if not isinstance(courses, list):
        raise RuntimeError("課程查詢系統回傳格式不是課程清單。")
    return courses


_ROOM_INPUT_RE = re.compile(r"^(?:TR[\s\-_]*)?(\d+(?:-\d+)?)$")


def normalize_room_code(room: str | None) -> str | None:
    """Canonicalize spellings like '613', 'tr613', 'TR 613' (also full-width) to 'TR-613'; unparseable input is only uppercased."""
    normalized = unicodedata.normalize("NFKC", normalize(room)).upper()
    if not normalized:
        return None
    match = _ROOM_INPUT_RE.match(normalized)
    return f"TR-{match.group(1)}" if match else normalized


def split_tr_rooms(classroom_text: str | None) -> list[str]:
    if not classroom_text:
        return []
    return [match.group(0).upper() for match in ROOM_RE.finditer(classroom_text)]


def split_course_nodes(node_text: str | None) -> list[str]:
    if not node_text:
        return []
    return [part.strip().upper() for part in re.split(r"[,、\s]+", node_text) if part.strip()]


def build_tr_meetings(courses: list[dict[str, Any]]) -> list[TRRoomMeeting]:
    meetings: list[TRRoomMeeting] = []
    for course in courses:
        rooms = split_tr_rooms(str(course.get("ClassRoomNo") or ""))
        nodes = split_course_nodes(str(course.get("Node") or ""))
        if not rooms or not nodes:
            continue

        if len(rooms) == len(nodes):
            pairs = zip(rooms, nodes, strict=False)
        else:
            pairs = ((room, node) for room in sorted(set(rooms), key=room_sort_key) for node in nodes)

        for room, node in pairs:
            meetings.append(
                TRRoomMeeting(
                    room=room,
                    node=node,
                    course_no=str(course.get("CourseNo") or ""),
                    course_name=str(course.get("CourseName") or ""),
                    teacher=str(course.get("CourseTeacher") or ""),
                )
            )
    return meetings


def room_sort_key(room: str) -> tuple[int, str]:
    numbers = re.findall(r"\d+", room)
    first = int(numbers[0]) if numbers else 0
    return first, room


def node_from_datetime(moment: datetime) -> str | None:
    local_moment = moment.astimezone(TAIPEI)
    day_code = DAY_CODES[local_moment.weekday()]
    local_time = local_moment.time()
    for period, start, end in CLASS_PERIODS:
        if start <= local_time <= end:
            return f"{day_code}{period}"
    return None


def next_node_from_datetime(moment: datetime) -> str:
    local_moment = moment.astimezone(TAIPEI)
    day_code = DAY_CODES[local_moment.weekday()]
    local_time = local_moment.time()

    for index, (period, start, end) in enumerate(CLASS_PERIODS):
        if local_time < start:
            return f"{day_code}{period}"
        if start <= local_time <= end:
            if index + 1 < len(CLASS_PERIODS):
                next_period = CLASS_PERIODS[index + 1][0]
                return f"{day_code}{next_period}"
            break

    next_day = local_moment + timedelta(days=1)
    next_day_code = DAY_CODES[next_day.weekday()]
    first_period = CLASS_PERIODS[0][0]
    return f"{next_day_code}{first_period}"


def label_for_node(node: str | None, moment: datetime) -> str:
    if node is None:
        return "目前不是正式節次"
    day_name = DAY_NAMES.get(node[0], "未知星期")
    return f"{day_name} 第 {node[1:]} 節（{node}）"


def occupied_meetings(meetings: list[TRRoomMeeting], node: str | None) -> dict[str, list[TRRoomMeeting]]:
    if node is None:
        return {}

    occupied: dict[str, list[TRRoomMeeting]] = {}
    for meeting in meetings:
        if meeting.node == node:
            occupied.setdefault(meeting.room, []).append(meeting)
    return occupied
