from __future__ import annotations

import os
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

try:
    from .api.courses import create_courses_router
    from .config import DEFAULT_VERIFY_SSL
    from .gpa import fetch_section_gpas
    from .api.gpa_api_key import create_gpa_api_key_router
    from .api.health import create_health_router
    from .api.planner_solve import create_planner_solve_router
    from .api.official_selection import create_official_selection_router
    from .api.planner import create_planner_router
    from .api.sync import create_sync_router
    from .api.tr_rooms import create_tr_rooms_router
    from .credentials import (
        delete_gpa_api_key,
        get_gpa_api_key_secret,
        get_gpa_api_key_status,
        put_gpa_api_key,
        resolve_user_id,
    )
    from .history import fetch_history_records
    from .moodle import fetch_moodle_assignments
    from .official_selection import get_official_selection_client
    from .planner_pdf import parse_requirement_pdf
    from .schedule import fetch_schedule
    from .snapshots import (
        ensure_schedule_entry_slot_times,
        load_history_snapshot,
        load_moodle_assignments_snapshot,
        load_snapshot,
        persist_history_snapshot,
        persist_moodle_assignments_snapshot,
        persist_snapshot,
    )
    from .time_utils import now
    from .tr_rooms import (
        fetch_query_courses,
        fetch_query_courses_filtered,
        prewarm_course_cache,
    )
    from .services import session_context
    from . import rate_limit
except ImportError:  # pragma: no cover - supports Railway backend/ cwd imports.
    from api.courses import create_courses_router
    from config import DEFAULT_VERIFY_SSL
    from gpa import fetch_section_gpas
    from api.gpa_api_key import create_gpa_api_key_router
    from api.health import create_health_router
    from api.planner_solve import create_planner_solve_router
    from api.official_selection import create_official_selection_router
    from api.planner import create_planner_router
    from api.sync import create_sync_router
    from api.tr_rooms import create_tr_rooms_router
    from credentials import (
        delete_gpa_api_key,
        get_gpa_api_key_secret,
        get_gpa_api_key_status,
        put_gpa_api_key,
        resolve_user_id,
    )
    from history import fetch_history_records
    from moodle import fetch_moodle_assignments
    from official_selection import get_official_selection_client
    from planner_pdf import parse_requirement_pdf
    from schedule import fetch_schedule
    from snapshots import (
        ensure_schedule_entry_slot_times,
        load_history_snapshot,
        load_moodle_assignments_snapshot,
        load_snapshot,
        persist_history_snapshot,
        persist_moodle_assignments_snapshot,
        persist_snapshot,
    )
    from time_utils import now
    from tr_rooms import (
        fetch_query_courses,
        fetch_query_courses_filtered,
        prewarm_course_cache,
    )
    from services import session_context
    import rate_limit


API_VERSION = "0.3.0"
OFFICIAL_SELECTION_CAPABILITIES = {
    "official_selection": True,
    "official_selection_actions": [
        "sync",
        "keep_alive",
        "join",
        "add_to_waitlist",
        "remove",
        "reorder",
    ],
}

@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # Daemon thread; skipped when TR_COURSE_PREWARM=0 (tests) and never blocks startup.
    prewarm_course_cache(DEFAULT_VERIFY_SSL)
    yield


app = FastAPI(title="Course Compass Sync API", version=API_VERSION, lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.environ.get("CORS_ORIGINS", "").split(",")
        if origin.strip()
    ],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 課程查詢／空教室是唯讀且不需登入的學校代理，被狂打會害這台的 IP 被學校擋。
rate_limit.install(app)


def _current_user_context(authorization: str | None) -> tuple[str, str]:
    return session_context.current_user_context(authorization, lambda token: resolve_user_id(token))


def _authorization_context(authorization: str | None) -> tuple[str, str] | None:
    return session_context.authorization_context(authorization, lambda value: _current_user_context(value))


def _optional_authorization_context(authorization: str | None) -> tuple[str, str] | None:
    return session_context.optional_authorization_context(
        authorization,
        lambda value: _authorization_context(value),
    )


def _optional_user_id(authorization: str | None) -> str:
    """User id for endpoints that work signed-out (course search): '' when absent/invalid."""
    context = _optional_authorization_context(authorization)
    return context[0] if context else ""


def _attach_gpa_to_synced_courses(courses: list[dict[str, Any]], authorization: str | None) -> None:
    """Best-effort GPA on synced schedule rows, using the caller's own myNTUST key."""
    api_key = get_gpa_api_key_secret(_optional_user_id(authorization))
    if not api_key:
        return
    sections = [
        (str(row.get("course_code") or ""), str(row.get("course_name") or ""), str(row.get("professor") or ""))
        for row in courses
    ]
    results = fetch_section_gpas(sections, api_key, DEFAULT_VERIFY_SSL)
    for row in courses:
        code = str(row.get("course_code") or "").strip().upper()
        if not code:
            continue
        result = results.get(code)
        if result is None:
            row["gpa"], row["gpa_status"] = None, "error"
            continue
        row.update(result.as_fields())


def _required_user_context(authorization: str | None) -> tuple[str, str]:
    return session_context.required_user_context(authorization, lambda value: _authorization_context(value))


app.include_router(create_health_router(API_VERSION, OFFICIAL_SELECTION_CAPABILITIES))
app.include_router(
    create_courses_router(
        lambda semester, **kwargs: fetch_query_courses_filtered(semester, **kwargs),
        # GPA token 只在後端解密使用；前端不再送 X-GPA-API-Key。
        lambda authorization: get_gpa_api_key_secret(_optional_user_id(authorization)),
        # 用 lambda 而不是直接傳函式：名稱在呼叫時才解析，測試才 monkeypatch 得到。
        lambda semester, refresh, verify_ssl: fetch_query_courses(semester, refresh, verify_ssl),
    )
)
app.include_router(
    create_planner_solve_router(lambda authorization: get_gpa_api_key_secret(_optional_user_id(authorization)))
)
app.include_router(
    create_gpa_api_key_router(
        lambda authorization: _current_user_context(authorization),
        lambda user_id: get_gpa_api_key_status(user_id),
        lambda user_id, api_key, enabled: put_gpa_api_key(user_id, api_key, enabled),
        lambda user_id: delete_gpa_api_key(user_id),
    )
)
app.include_router(
    create_planner_router(
        lambda pdf_bytes, filename: parse_requirement_pdf(pdf_bytes, filename),
        lambda authorization: _current_user_context(authorization),
    )
)
app.include_router(create_tr_rooms_router())
app.include_router(
    create_sync_router(
        lambda authorization: _required_user_context(authorization),
        lambda username, password, verify_ssl: fetch_schedule(username, password, verify_ssl),
        lambda username, password, verify_ssl: fetch_history_records(username, password, verify_ssl),
        lambda username, password, verify_ssl: fetch_moodle_assignments(username, password, verify_ssl),
        lambda user_id, profile_key, school_account, payload: persist_snapshot(user_id, profile_key, school_account, payload),
        lambda user_id, profile_key, school_account, payload: persist_history_snapshot(user_id, profile_key, school_account, payload),
        lambda user_id, profile_key, school_account, payload: persist_moodle_assignments_snapshot(
            user_id,
            profile_key,
            school_account,
            payload,
        ),
        lambda user_id, profile_key: load_snapshot(user_id, profile_key),
        lambda user_id, profile_key: load_history_snapshot(user_id, profile_key),
        lambda user_id, profile_key: load_moodle_assignments_snapshot(user_id, profile_key),
        lambda payload: ensure_schedule_entry_slot_times(payload),
        lambda: now().isoformat(),
        lambda courses, authorization: _attach_gpa_to_synced_courses(courses, authorization),
    )
)
app.include_router(
    create_official_selection_router(
        lambda profile_key: get_official_selection_client(profile_key),
        lambda authorization: _required_user_context(authorization),
        session_context.official_client_key,
        session_context.require_official_action_confirmation,
        lambda: now().isoformat(),
    )
)


# --- Optional: serve the built web app from the same origin --------------------
WEB_DIST_DIR = Path(os.environ.get("WEB_DIST_DIR") or Path(__file__).resolve().parent.parent / "web" / "dist")

if (WEB_DIST_DIR / "index.html").is_file():
    app.mount("/assets", StaticFiles(directory=WEB_DIST_DIR / "assets"), name="web-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_web_app(full_path: str) -> FileResponse:
        if full_path.startswith("api/") or full_path in {"docs", "openapi.json", "redoc"}:
            raise HTTPException(status_code=404)
        candidate = (WEB_DIST_DIR / full_path).resolve()
        if full_path and candidate.is_file() and WEB_DIST_DIR.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(WEB_DIST_DIR / "index.html")
