"""Best-effort Supabase second-level cache for myNTUST responses."""

from __future__ import annotations

import logging
import math
from dataclasses import asdict
from typing import TYPE_CHECKING, Any

import requests

try:
    from .config import DEFAULT_TIMEOUT, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
except ImportError:  # pragma: no cover
    from config import DEFAULT_TIMEOUT, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL

if TYPE_CHECKING:
    try:
        from .gpa import GradeRecord, HistoryRow
    except ImportError:  # pragma: no cover
        from gpa import GradeRecord, HistoryRow


logger = logging.getLogger(__name__)
RPC_BASE = "/rest/v1/rpc"


def _configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def _service_role_headers() -> dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def _post_rpc(name: str, payload: dict[str, Any], *, read_response: bool) -> tuple[bool, Any]:
    if not _configured():
        return False, None
    try:
        response = requests.post(
            f"{SUPABASE_URL}{RPC_BASE}/{name}",
            headers=_service_role_headers(),
            json=payload,
            timeout=DEFAULT_TIMEOUT,
        )
        if response.status_code >= 300:
            raise requests.HTTPError(f"Supabase RPC {name} returned HTTP {response.status_code}")
        return True, response.json() if read_response else None
    except (requests.RequestException, ValueError, TypeError, AttributeError) as exc:
        logger.debug("Supabase myNTUST cache RPC %s failed", name, exc_info=exc)
        return False, None


def _normalize_course_no(value: Any) -> str:
    return str(value or "").strip().upper()


def _normalize_course_name(value: Any) -> str:
    return str(value or "").replace("（", "(").replace("）", ")").replace(" ", "").replace("　", "").strip()


def _unique_course_nos(course_nos: list[str]) -> list[str]:
    return list(dict.fromkeys(_normalize_course_no(value) for value in course_nos if _normalize_course_no(value)))


def _unique_course_names(names: list[str]) -> list[str]:
    return list(dict.fromkeys(_normalize_course_name(value) for value in names if _normalize_course_name(value)))


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError("boolean is not a numeric GPA")
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError("GPA must be finite")
    return parsed


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError("boolean is not an integer")
    parsed = int(value)
    if isinstance(value, float) and value != parsed:
        raise ValueError("value is not an integer")
    return parsed


def _parse_distribution(value: Any) -> dict[str, int] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("grade distribution is not an object")
    distribution: dict[str, int] = {}
    for key, count in value.items():
        parsed = _optional_int(count)
        if parsed is None:
            raise ValueError("grade distribution contains a null count")
        distribution[str(key)] = parsed
    return distribution


def _parse_grade(row: Any):
    if not isinstance(row, dict):
        raise ValueError("grade cache row is not an object")
    course_no = _normalize_course_no(row.get("course_no"))
    status = row.get("status")
    if not course_no or not isinstance(status, str) or not status.strip():
        raise ValueError("grade cache row is missing its key or status")
    try:
        from .gpa import GradeRecord
    except ImportError:  # pragma: no cover
        from gpa import GradeRecord

    return course_no, GradeRecord(
        _optional_float(row.get("gpa")),
        status,
        _optional_int(row.get("semester")),
        _optional_int(row.get("students")),
        _parse_distribution(row.get("distribution")),
    )


def _parse_history_row(row: Any):
    if not isinstance(row, dict):
        raise ValueError("history cache row is not an object")
    course_no = _normalize_course_no(row.get("course_no"))
    course_name = _normalize_course_name(row.get("course_name"))
    lecturer = row.get("lecturer")
    semester = _optional_int(row.get("semester"))
    node = row.get("node")
    classroom = row.get("classroom")
    if (
        not course_no
        or not course_name
        or not isinstance(lecturer, str)
        or semester is None
        or not isinstance(node, str)
        or not isinstance(classroom, str)
    ):
        raise ValueError("history cache row is missing a required field")
    try:
        from .gpa import HistoryRow
    except ImportError:  # pragma: no cover
        from gpa import HistoryRow

    return HistoryRow(
        course_no,
        course_name,
        lecturer,
        semester,
        node,
        _optional_int(row.get("credit")),
        classroom,
    )


def load_grades(course_nos: list[str]) -> dict[str, "GradeRecord"]:
    """Load fresh grade records in one RPC call; failures are intentionally ignored."""
    keys = _unique_course_nos(course_nos)
    if not keys:
        return {}
    ok, payload = _post_rpc(
        "get_myntust_cache",
        {"p_kind": "grade", "p_keys": keys},
        read_response=True,
    )
    if not ok:
        return {}
    try:
        if not isinstance(payload, list):
            raise ValueError("grade cache response is not a list")
        parsed = dict(_parse_grade(row) for row in payload)
        return {key: parsed[key] for key in keys if key in parsed}
    except Exception as exc:
        logger.debug("Supabase myNTUST grade cache payload was invalid", exc_info=exc)
        return {}


def save_grade(course_no: str, record: "GradeRecord") -> None:
    """Persist a successful grade response without affecting myNTUST throttling."""
    key = _normalize_course_no(course_no)
    if not key:
        return
    try:
        if record.status not in {"found", "no_data"}:
            return
        _post_rpc(
            "upsert_myntust_grade",
            {
                "p_course_no": key,
                "p_status": record.status,
                "p_gpa": record.gpa,
                "p_semester": record.semester,
                "p_students": record.students,
                "p_distribution": record.distribution,
            },
            read_response=False,
        )
    except Exception as exc:
        logger.debug("Supabase myNTUST grade cache payload was invalid", exc_info=exc)


def load_histories(names: list[str]) -> dict[str, list["HistoryRow"]]:
    """Load fresh teaching histories in one RPC call; failures are best-effort."""
    keys = _unique_course_names(names)
    if not keys:
        return {}
    ok, payload = _post_rpc(
        "get_myntust_cache",
        {"p_kind": "history", "p_keys": keys},
        read_response=True,
    )
    if not ok:
        return {}
    try:
        if not isinstance(payload, list):
            raise ValueError("history cache response is not a list")
        parsed: dict[str, list[HistoryRow]] = {}
        for row in payload:
            if not isinstance(row, dict):
                raise ValueError("history cache row is not an object")
            name = _normalize_course_name(row.get("course_name"))
            rows = row.get("rows")
            if not name or not isinstance(rows, list):
                raise ValueError("history cache row is missing its key or rows")
            parsed[name] = [_parse_history_row(item) for item in rows]
        return {key: parsed[key] for key in keys if key in parsed}
    except Exception as exc:
        logger.debug("Supabase myNTUST history cache payload was invalid", exc_info=exc)
        return {}


def save_history(name: str, rows: list["HistoryRow"]) -> None:
    """Persist a successful teaching-history response without raising on failure."""
    key = _normalize_course_name(name)
    if not key:
        return
    try:
        serialized = [asdict(row) for row in rows]
        if any(not isinstance(row, dict) for row in serialized):
            raise ValueError("history cache rows are not objects")
        _post_rpc(
            "upsert_myntust_history",
            {"p_course_name": key, "p_rows": serialized},
            read_response=False,
        )
    except Exception as exc:
        logger.debug("Supabase myNTUST history cache payload was invalid", exc_info=exc)
