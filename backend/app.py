from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

try:
    from .api.courses import create_courses_router
    from .api.health import create_health_router
    from .api.official_selection import create_official_selection_router
    from .api.planner import create_planner_router
    from .api.school_credentials import create_school_credentials_router
    from .api.sync import create_sync_router
    from .api.tr_rooms import create_tr_rooms_router
    from .credentials import (
        CredentialStoreError,
        delete_school_credentials,
        get_school_credentials_secret,
        get_school_credentials_status,
        put_school_credentials,
        resolve_user_id,
    )
    from .history import fetch_history_records
    from .moodle import fetch_moodle_assignments
    from .official_selection import get_official_selection_client
    from .planner_pdf import parse_requirement_pdf
    from .schedule import fetch_schedule
    from .school_sessions import (
        delete_school_session,
        load_school_session_state,
        official_session_expires_at,
        save_school_session_state,
    )
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
        fetch_query_courses_filtered,
    )
except ImportError:  # pragma: no cover - supports Railway backend/ cwd imports.
    from api.courses import create_courses_router
    from api.health import create_health_router
    from api.official_selection import create_official_selection_router
    from api.planner import create_planner_router
    from api.school_credentials import create_school_credentials_router
    from api.sync import create_sync_router
    from api.tr_rooms import create_tr_rooms_router
    from credentials import (
        CredentialStoreError,
        delete_school_credentials,
        get_school_credentials_secret,
        get_school_credentials_status,
        put_school_credentials,
        resolve_user_id,
    )
    from history import fetch_history_records
    from moodle import fetch_moodle_assignments
    from official_selection import get_official_selection_client
    from planner_pdf import parse_requirement_pdf
    from schedule import fetch_schedule
    from school_sessions import (
        delete_school_session,
        load_school_session_state,
        official_session_expires_at,
        save_school_session_state,
    )
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
        fetch_query_courses_filtered,
    )


API_VERSION = "0.3.0"
OFFICIAL_SELECTION_CAPABILITIES = {
    "school_credentials": True,
    "school_sessions": True,
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

app = FastAPI(title="Course Compass Sync API", version=API_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://course-planner-web.vercel.app",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app|http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _current_user_context(authorization: str | None) -> tuple[str, str]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="請先登入後再保存校務帳密。")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="請先登入後再保存校務帳密。")
    try:
        return resolve_user_id(token), token
    except CredentialStoreError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Supabase 使用者驗證失敗：{exc}") from exc


def _authorization_context(authorization: str | None) -> tuple[str, str] | None:
    if not authorization:
        return None
    return _current_user_context(authorization)


def _optional_authorization_context(authorization: str | None) -> tuple[str, str] | None:
    try:
        return _authorization_context(authorization)
    except HTTPException:
        return None


def _saved_school_credentials(
    username: str,
    authorization: str | None,
    *,
    required: bool = False,
) -> tuple[str, str] | None:
    context = _authorization_context(authorization)
    if context is None:
        if required:
            raise HTTPException(status_code=401, detail="請先登入後再使用已保存的校務帳密。")
        return None

    user_id, access_token = context
    try:
        credentials = get_school_credentials_secret(user_id, access_token)
    except CredentialStoreError as exc:
        if required:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return None
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"讀取校務帳密失敗：{exc}") from exc

    saved_username = str(credentials.get("username") or "").strip()
    password = str(credentials.get("password") or "")
    if saved_username and saved_username != username:
        raise HTTPException(status_code=403, detail="已保存的校務帳號與本次操作帳號不同。")
    if not password:
        if required:
            raise HTTPException(status_code=400, detail="尚未保存校務密碼，請先輸入帳密同步一次。")
        return None
    return saved_username or username, password


def _official_password(username: str, password: str | None, authorization: str | None) -> str | None:
    if password:
        return password
    saved_credentials = _saved_school_credentials(username, authorization)
    return saved_credentials[1] if saved_credentials else None


def _required_school_password(username: str, password: str | None, authorization: str | None) -> str:
    resolved_password = _official_password(username, password, authorization)
    if not resolved_password:
        raise HTTPException(status_code=400, detail="請輸入校務密碼，或先保存校務帳密後再同步。")
    return resolved_password


def _ensure_official_session(
    profile_key: str,
    username: str,
    password: str | None,
    authorization: str | None,
    verify_ssl: bool,
) -> Any:
    client = get_official_selection_client(profile_key)
    context = _optional_authorization_context(authorization)
    if _reuse_official_session(client, username, context, verify_ssl):
        return client

    resolved_password = _official_password(username, password, authorization)
    if resolved_password:
        client.ensure_session(username, resolved_password, verify_ssl)
        _persist_official_session(context, username, client)
    return client


def _persist_official_session(
    context: tuple[str, str] | None,
    username: str,
    client: Any,
) -> None:
    if context is None:
        return
    try:
        save_school_session_state(
            context[0],
            username,
            client.export_session_state(),
            expires_at=official_session_expires_at(),
            last_keep_alive_at=datetime.now(timezone.utc),
        )
    except (CredentialStoreError, requests.RequestException, AttributeError, TypeError, ValueError):
        return


def _delete_official_session(context: tuple[str, str] | None, username: str | None = None) -> None:
    if context is None:
        return
    try:
        delete_school_session(context[0], username)
    except (CredentialStoreError, requests.RequestException):
        return


def _reuse_official_session(
    client: Any,
    username: str,
    context: tuple[str, str] | None,
    verify_ssl: bool,
) -> bool:
    try:
        if client.keep_alive(verify_ssl):
            _persist_official_session(context, username, client)
            return True
    except (RuntimeError, requests.RequestException, AttributeError):
        pass

    if context is None:
        return False

    try:
        saved_session = load_school_session_state(context[0], username)
    except (CredentialStoreError, requests.RequestException):
        return False
    if not saved_session:
        return False

    try:
        if not client.restore_session_state(saved_session["session_state"]):
            _delete_official_session(context, username)
            return False
        if client.keep_alive(verify_ssl):
            _persist_official_session(context, username, client)
            return True
    except (RuntimeError, requests.RequestException, AttributeError, KeyError, TypeError):
        pass

    _delete_official_session(context, username)
    return False


def _require_official_action_confirmation(confirmed: bool) -> None:
    if not confirmed:
        raise HTTPException(status_code=400, detail="官方選課操作需要使用者明確確認後才能送出。")


app.include_router(create_health_router(API_VERSION, OFFICIAL_SELECTION_CAPABILITIES))
app.include_router(
    create_courses_router(
        lambda semester, course_no, course_name, verify_ssl: fetch_query_courses_filtered(
            semester,
            course_no=course_no,
            course_name=course_name,
            verify_ssl=verify_ssl,
        )
    )
)
app.include_router(create_planner_router(lambda pdf_bytes, filename: parse_requirement_pdf(pdf_bytes, filename)))
app.include_router(
    create_school_credentials_router(
        lambda authorization: _current_user_context(authorization),
        lambda context, username: _delete_official_session(context, username),
        lambda user_id, access_token: get_school_credentials_status(user_id, access_token),
        lambda user_id, username, password, access_token: put_school_credentials(
            user_id,
            username,
            password,
            access_token,
        ),
        lambda user_id, access_token: delete_school_credentials(user_id, access_token),
    )
)
app.include_router(create_tr_rooms_router())
app.include_router(
    create_sync_router(
        lambda username, password, authorization: _required_school_password(username, password, authorization),
        lambda username, password, verify_ssl: fetch_schedule(username, password, verify_ssl),
        lambda username, password, verify_ssl: fetch_history_records(username, password, verify_ssl),
        lambda username, password, verify_ssl: fetch_moodle_assignments(username, password, verify_ssl),
        lambda profile_key, school_account, payload: persist_snapshot(profile_key, school_account, payload),
        lambda profile_key, school_account, payload: persist_history_snapshot(profile_key, school_account, payload),
        lambda profile_key, school_account, payload: persist_moodle_assignments_snapshot(
            profile_key,
            school_account,
            payload,
        ),
        lambda profile_key: load_snapshot(profile_key),
        lambda profile_key: load_history_snapshot(profile_key),
        lambda profile_key: load_moodle_assignments_snapshot(profile_key),
        lambda payload: ensure_schedule_entry_slot_times(payload),
        lambda: now().isoformat(),
    )
)
app.include_router(
    create_official_selection_router(
        lambda profile_key: get_official_selection_client(profile_key),
        lambda authorization: _optional_authorization_context(authorization),
        lambda client, username, context, verify_ssl: _reuse_official_session(client, username, context, verify_ssl),
        lambda profile_key, username, password, authorization, verify_ssl: _ensure_official_session(
            profile_key,
            username,
            password,
            authorization,
            verify_ssl,
        ),
        lambda context, username, client: _persist_official_session(context, username, client),
        lambda context, username: _delete_official_session(context, username),
        lambda username, password, authorization: _official_password(username, password, authorization),
        lambda username, authorization: _saved_school_credentials(username, authorization),
        lambda confirmed: _require_official_action_confirmation(confirmed),
        lambda: now().isoformat(),
    )
)
