from __future__ import annotations

import re
import threading
import time
from collections import deque
from typing import Any

import requests
from bs4 import BeautifulSoup, Tag
from requests.cookies import create_cookie

try:
    from ..core.config import (
        COURSE_LIST_URL,
        DEFAULT_TIMEOUT,
        INITIAL_SELECTION_JOIN_URL,
        INITIAL_SELECTION_REMOVE_URL,
        INITIAL_SELECTION_SAVE_INDEX_URL,
        INITIAL_SELECTION_URL,
    )
    from ..core.time_utils import now
    from .ntust_common import login, normalize, requires_hidden_form_callback, split_lines, submit_hidden_form
    from .schedule import find_latest_course_list_url, parse_course_list
except ImportError:  # pragma: no cover
    from core.config import (
        COURSE_LIST_URL,
        DEFAULT_TIMEOUT,
        INITIAL_SELECTION_JOIN_URL,
        INITIAL_SELECTION_REMOVE_URL,
        INITIAL_SELECTION_SAVE_INDEX_URL,
        INITIAL_SELECTION_URL,
    )
    from integrations.ntust_common import login, normalize, requires_hidden_form_callback, split_lines, submit_hidden_form
    from integrations.schedule import find_latest_course_list_url, parse_course_list
    from core.time_utils import now


MIN_LOGIN_INTERVAL_SECONDS = 10
MAX_LOGINS_PER_MINUTE = 5
MAX_CLIENT_IDLE_SECONDS = 30 * 60
OFFICIAL_SCHEDULE_HEADERS = ["節次", "時間", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]
OFFICIAL_SCHEDULE_PERIODS = [
    ("1", "08:10～09:00"),
    ("2", "9:10～10:00"),
    ("3", "10:20～11:10"),
    ("4", "11:20～12:10"),
    ("5", "12:20～13:10"),
    ("6", "13:20～14:10"),
    ("7", "14:20～15:10"),
    ("8", "15:30～16:20"),
    ("9", "16:30～17:20"),
    ("10", "17:30～18:20"),
    ("A", "18:25～19:15"),
    ("B", "19:20～20:10"),
    ("C", "20:15～21:05"),
    ("D", "21:10～22:00"),
]

_clients: dict[str, "OfficialSelectionClient"] = {}
_clients_lock = threading.Lock()


def get_official_selection_client(profile_key: str) -> "OfficialSelectionClient":
    cleanup_official_selection_clients()
    with _clients_lock:
        client = _clients.get(profile_key)
        if client is None:
            client = OfficialSelectionClient()
            _clients[profile_key] = client
        return client


def cleanup_official_selection_clients() -> None:
    cutoff = time.time() - MAX_CLIENT_IDLE_SECONDS
    with _clients_lock:
        for key, client in list(_clients.items()):
            if client.last_used_at < cutoff:
                del _clients[key]


class OfficialSelectionClient:
    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/122.0.0.0 Safari/537.36"
                ),
                "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
            }
        )
        self.is_logged_in = False
        self.last_used_at = time.time()
        self.last_login_at: float | None = None
        self.login_times: deque[float] = deque()
        self.lock = threading.Lock()

    def fetch_a02_workspace(self, username: str, password: str, verify_ssl: bool) -> dict[str, Any]:
        with self.lock:
            self.last_used_at = time.time()
            page_response = self.ensure_session(username, password, verify_ssl)
            if page_response.url.rstrip("/") != INITIAL_SELECTION_URL.rstrip("/"):
                page_response = self._get_workspace_page(verify_ssl)
            return self._workspace_payload(page_response, verify_ssl)

    def fetch_current_a02_workspace(self, verify_ssl: bool) -> dict[str, Any]:
        with self.lock:
            self.last_used_at = time.time()
            return self._workspace_payload(self._get_workspace_page(verify_ssl), verify_ssl)

    def export_session_state(self) -> dict[str, Any]:
        cookies: list[dict[str, Any]] = []
        for cookie in self.session.cookies:
            cookies.append(
                {
                    "name": cookie.name,
                    "value": cookie.value,
                    "domain": cookie.domain,
                    "path": cookie.path,
                    "expires": cookie.expires,
                    "secure": cookie.secure,
                    "rest": dict(getattr(cookie, "_rest", {}) or {}),
                }
            )
        return {
            "cookies": cookies,
            "is_logged_in": self.is_logged_in,
            "saved_at": now().isoformat(),
        }

    def restore_session_state(self, session_state: dict[str, Any]) -> bool:
        cookies = session_state.get("cookies")
        if not isinstance(cookies, list) or not cookies:
            return False

        self.session.cookies.clear()
        restored = 0
        for raw_cookie in cookies:
            if not isinstance(raw_cookie, dict):
                continue
            name = str(raw_cookie.get("name") or "")
            value = str(raw_cookie.get("value") or "")
            if not name:
                continue
            expires = raw_cookie.get("expires")
            cookie = create_cookie(
                name=name,
                value=value,
                domain=str(raw_cookie.get("domain") or ""),
                path=str(raw_cookie.get("path") or "/"),
                secure=bool(raw_cookie.get("secure")),
                expires=int(expires) if isinstance(expires, (int, float)) else None,
                rest=raw_cookie.get("rest") if isinstance(raw_cookie.get("rest"), dict) else None,
            )
            self.session.cookies.set_cookie(cookie)
            restored += 1

        self.is_logged_in = bool(restored)
        self.last_used_at = time.time()
        return bool(restored)

    def join_course(self, course_no: str, verify_ssl: bool) -> dict[str, Any]:
        return self._submit_course_action(
            course_no=course_no,
            endpoint=INITIAL_SELECTION_JOIN_URL,
            action_type=1,
            verify_ssl=verify_ssl,
        )

    def add_course_to_waitlist(self, course_no: str, verify_ssl: bool) -> dict[str, Any]:
        return self._submit_course_action(
            course_no=course_no,
            endpoint=INITIAL_SELECTION_JOIN_URL,
            action_type=3,
            verify_ssl=verify_ssl,
        )

    def remove_course(self, course_no: str, verify_ssl: bool) -> dict[str, Any]:
        return self._submit_course_action(
            course_no=course_no,
            endpoint=INITIAL_SELECTION_REMOVE_URL,
            action_type=2,
            verify_ssl=verify_ssl,
        )

    def reorder_registered_courses(self, ordered_course_nos: list[str], verify_ssl: bool) -> dict[str, Any]:
        normalized_course_nos = [
            course_no.strip().upper()
            for course_no in ordered_course_nos
            if course_no.strip()
        ]
        if not normalized_course_nos:
            raise RuntimeError("缺少官方志願序資料，無法儲存。")
        if len(normalized_course_nos) != len(set(normalized_course_nos)):
            raise RuntimeError("官方志願序包含重複課碼，請重新同步後再試。")

        with self.lock:
            self.last_used_at = time.time()
            page_response = self._get_workspace_page(verify_ssl)
            payload = parse_a02_workspace(page_response.text)
            registered_courses = payload["registered_courses"]
            current_by_no = {
                str(course["course_no"]).strip().upper(): course
                for course in registered_courses
            }
            if set(current_by_no) != set(normalized_course_nos):
                raise RuntimeError("官方志願清單已變更，請重新同步後再調整志願序。")

            rows = [["志願序", "課碼", "課程名稱", "取消加入"]]
            for index, course_no in enumerate(normalized_course_nos, start=1):
                course = current_by_no[course_no]
                rows.append([str(index), course_no, str(course.get("course_name") or ""), "取消加入"])

            response = self.session.post(
                INITIAL_SELECTION_SAVE_INDEX_URL,
                data=_arraydata_form_rows(rows),
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Referer": INITIAL_SELECTION_URL,
                    "X-Requested-With": "XMLHttpRequest",
                },
                timeout=DEFAULT_TIMEOUT,
                allow_redirects=True,
                verify=verify_ssl,
            )
            response.raise_for_status()
            response = self._complete_callback_if_needed(response, verify_ssl)
            if _is_auth_response(response):
                self.is_logged_in = False
                raise RuntimeError("Session 已失效，請重新同步官方初選資料後再送出。")
            action_notices = _parse_action_response_notices(response.text)
            payload = self._workspace_payload(self._get_workspace_page(verify_ssl), verify_ssl)
            if action_notices:
                payload["notices"] = _merge_unique_texts(action_notices, payload.get("notices", []))
            return payload

    def ensure_session(self, username: str, password: str, verify_ssl: bool) -> requests.Response:
        if self._check_session_quick(verify_ssl):
            return self._get_workspace_page(verify_ssl)

        self._check_login_rate_limit()
        login(self.session, username, password, verify_ssl)
        self.is_logged_in = True
        self.last_login_at = time.time()
        self.login_times.append(self.last_login_at)
        return self._get_workspace_page(verify_ssl)

    def keep_alive(self, verify_ssl: bool) -> bool:
        try:
            response = self.session.get(
                INITIAL_SELECTION_URL,
                timeout=5,
                allow_redirects=True,
                verify=verify_ssl,
                stream=True,
            )
            response.close()
            self.is_logged_in = not _is_auth_response(response)
            self.last_used_at = time.time()
            return self.is_logged_in
        except requests.RequestException:
            self.is_logged_in = False
            return False

    def _get_workspace_page(self, verify_ssl: bool) -> requests.Response:
        response = self.session.get(
            INITIAL_SELECTION_URL,
            timeout=DEFAULT_TIMEOUT,
            allow_redirects=True,
            verify=verify_ssl,
        )
        response.raise_for_status()
        response = self._complete_callback_if_needed(response, verify_ssl)
        if _is_auth_response(response):
            self.is_logged_in = False
            raise RuntimeError("Session 已失效，請重新登入官方選課系統。")
        self.is_logged_in = True
        return response

    def _submit_course_action(
        self,
        course_no: str,
        endpoint: str,
        action_type: int,
        verify_ssl: bool,
    ) -> dict[str, Any]:
        normalized_course_no = course_no.strip().upper()
        if not normalized_course_no:
            raise RuntimeError("缺少課碼，無法送出官方選課請求。")
        with self.lock:
            self.last_used_at = time.time()
            self._get_workspace_page(verify_ssl)
            response = self.session.post(
                endpoint,
                data={"CourseNo": normalized_course_no, "type": action_type},
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Referer": INITIAL_SELECTION_URL,
                    "X-Requested-With": "XMLHttpRequest",
                },
                timeout=DEFAULT_TIMEOUT,
                allow_redirects=True,
                verify=verify_ssl,
            )
            response.raise_for_status()
            response = self._complete_callback_if_needed(response, verify_ssl)
            if _is_auth_response(response):
                self.is_logged_in = False
                raise RuntimeError("Session 已失效，請重新同步官方初選資料後再送出。")
            action_notices = _parse_action_response_notices(response.text)
            payload = self._workspace_payload(self._get_workspace_page(verify_ssl), verify_ssl)
            if action_notices:
                payload["notices"] = _merge_unique_texts(action_notices, payload.get("notices", []))
            return payload

    def _check_session_quick(self, verify_ssl: bool) -> bool:
        try:
            response = self.session.head(
                INITIAL_SELECTION_URL,
                timeout=3,
                allow_redirects=True,
                verify=verify_ssl,
            )
            if response.status_code == 405:
                return self.keep_alive(verify_ssl)
            self.is_logged_in = not _is_auth_response(response)
            return self.is_logged_in
        except requests.RequestException:
            self.is_logged_in = False
            return False

    def _complete_callback_if_needed(self, response: requests.Response, verify_ssl: bool) -> requests.Response:
        if requires_hidden_form_callback(response):
            response = submit_hidden_form(self.session, response, verify_ssl)
            response = self.session.get(
                INITIAL_SELECTION_URL,
                timeout=DEFAULT_TIMEOUT,
                allow_redirects=True,
                verify=verify_ssl,
            )
            response.raise_for_status()
        return response

    def _check_login_rate_limit(self) -> None:
        current_time = time.time()
        while self.login_times and current_time - self.login_times[0] > 60:
            self.login_times.popleft()
        if self.last_login_at is not None and current_time - self.last_login_at < MIN_LOGIN_INTERVAL_SECONDS:
            wait_seconds = int(MIN_LOGIN_INTERVAL_SECONDS - (current_time - self.last_login_at)) + 1
            raise RuntimeError(f"登入太頻繁，請 {wait_seconds} 秒後再試。")
        if len(self.login_times) >= MAX_LOGINS_PER_MINUTE:
            raise RuntimeError("登入太頻繁，請稍後再試。")

    def _workspace_payload(self, page_response: requests.Response, verify_ssl: bool) -> dict[str, Any]:
        payload = parse_a02_workspace(page_response.text)
        if not _schedule_rows_have_weekday_data(payload["schedule_rows"]):
            fallback_rows = self._fetch_course_list_schedule_rows(verify_ssl)
            if fallback_rows:
                payload["schedule_rows"] = fallback_rows
                payload["notices"].append("官方功課表由選課清單頁補齊。")
        return {
            **payload,
            "source_url": page_response.url,
            "synced_at": now().isoformat(),
            "session_valid": True,
        }

    def _fetch_course_list_schedule_rows(self, verify_ssl: bool) -> list[dict[str, str]]:
        try:
            response = self.session.get(
                COURSE_LIST_URL,
                timeout=DEFAULT_TIMEOUT,
                allow_redirects=True,
                verify=verify_ssl,
            )
            response.raise_for_status()
            if "signin-oidc" in response.url:
                submit_hidden_form(self.session, response, verify_ssl)
                response = self.session.get(
                    COURSE_LIST_URL,
                    timeout=DEFAULT_TIMEOUT,
                    allow_redirects=True,
                    verify=verify_ssl,
                )
                response.raise_for_status()
            if _is_auth_response(response):
                return []

            latest_course_list_url = find_latest_course_list_url(response.text, response.url, COURSE_LIST_URL)
            if latest_course_list_url != response.url.split("#", 1)[0]:
                response = self.session.get(
                    latest_course_list_url,
                    timeout=DEFAULT_TIMEOUT,
                    allow_redirects=True,
                    verify=verify_ssl,
                )
                response.raise_for_status()
                if "signin-oidc" in response.url:
                    submit_hidden_form(self.session, response, verify_ssl)
                    response = self.session.get(
                        latest_course_list_url,
                        timeout=DEFAULT_TIMEOUT,
                        allow_redirects=True,
                        verify=verify_ssl,
                    )
                    response.raise_for_status()
                if _is_auth_response(response):
                    return []

            extracted = parse_course_list(response.text)
            return _schedule_rows_from_slots(extracted["slots"])
        except (RuntimeError, requests.RequestException):
            return []


def parse_a02_workspace(html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    available = _parse_available_courses(soup)
    registered = _parse_registered_courses(soup)
    schedule_rows = _parse_schedule_table_rows(soup.select_one("#loginModal table"))
    selection_list_rows = _parse_generic_table_rows(soup.select_one("#loginModal2 table"))
    required_preset_rows = _parse_generic_table_rows(soup.select_one("#DetermineTable"))
    registered = _merge_registered_course_details(registered, selection_list_rows)

    return {
        "page_title": normalize(soup.title.get_text(" ", strip=True) if soup.title else ""),
        "available_count": len(available),
        "registered_count": len(registered),
        "available_courses": available,
        "registered_courses": registered,
        "schedule_rows": schedule_rows,
        "selection_list_rows": selection_list_rows,
        "required_preset_rows": required_preset_rows,
        "notices": _parse_notice_texts(soup),
    }


def _schedule_rows_have_weekday_data(rows: list[dict[str, str]]) -> bool:
    weekdays = OFFICIAL_SCHEDULE_HEADERS[2:]
    return any(any(row.get(weekday) for weekday in weekdays) for row in rows)


def _schedule_rows_from_slots(slots: list[dict[str, Any]]) -> list[dict[str, str]]:
    rows = [
        {header: "" for header in OFFICIAL_SCHEDULE_HEADERS}
        for _period, _time in OFFICIAL_SCHEDULE_PERIODS
    ]
    period_index = {period: index for index, (period, _time) in enumerate(OFFICIAL_SCHEDULE_PERIODS)}
    for index, (period, time_text) in enumerate(OFFICIAL_SCHEDULE_PERIODS):
        rows[index]["節次"] = period
        rows[index]["時間"] = time_text

    for slot in slots:
        period = str(slot.get("period") or "").strip()
        weekday = str(slot.get("weekday_label") or "").strip()
        course_name = str(slot.get("course_name") or "").strip()
        if period not in period_index or weekday not in OFFICIAL_SCHEDULE_HEADERS or not course_name:
            continue
        row = rows[period_index[period]]
        row[weekday] = "、".join([value for value in [row[weekday], course_name] if value])

    return rows


def _arraydata_form_rows(rows: list[list[str]]) -> list[tuple[str, str]]:
    fields: list[tuple[str, str]] = []
    for row_index, row in enumerate(rows):
        for column_index, value in enumerate(row):
            fields.append((f"Arraydata[{row_index}][{column_index}]", value))
    return fields


def _parse_available_courses(soup: BeautifulSoup) -> list[dict[str, str]]:
    rows = _extract_div_table_rows(soup.select_one("#draggable"))
    if not rows:
        table = _find_table_containing(soup, ["課碼", "課程名稱", "上課教師", "加入登記"])
        rows = _extract_html_table_rows(table) if table else []
    body_rows = _drop_header_rows(rows, {"課碼", "課程名稱", "上課教師"})

    courses: list[dict[str, str]] = []
    for cells in body_rows:
        if len(cells) < 3:
            continue
        course_no, course_name, teacher = cells[0], cells[1], cells[2]
        if not course_no or course_no == "課碼":
            continue
        courses.append(
            {
                "course_no": course_no,
                "course_name": course_name,
                "teacher": teacher,
            }
        )
    return courses


def _parse_registered_courses(soup: BeautifulSoup) -> list[dict[str, str | int | None]]:
    rows = _extract_html_table_rows(soup.select_one("#cartTable"))
    if not rows:
        rows = _extract_div_table_rows(soup.select_one("#cartTable"))
    body_rows = _drop_header_rows(rows, {"志願序", "課碼", "課程名稱"})

    courses: list[dict[str, str | int | None]] = []
    for cells in body_rows:
        if len(cells) < 3:
            continue
        priority_text, course_no, course_name = cells[0], cells[1], cells[2]
        if not course_no or course_no == "課碼":
            continue
        courses.append(
            {
                "priority": _as_int(priority_text),
                "course_no": course_no,
                "course_name": course_name,
                "raw_priority": priority_text,
                "credits": None,
                "require_option": "",
                "teacher": "",
            }
        )
    return courses


def _merge_registered_course_details(
    registered_courses: list[dict[str, Any]],
    selection_list_rows: list[dict[str, str]],
) -> list[dict[str, Any]]:
    details_by_course_no: dict[str, dict[str, Any]] = {}
    for row in selection_list_rows:
        course_no = _row_value(row, ["課碼", "課程代碼", "課號"]).strip().upper()
        if not course_no:
            continue
        details_by_course_no[course_no] = {
            "course_no": course_no,
            "course_name": _row_value(row, ["課程名稱", "課名"]),
            "credits": _as_float(_row_value(row, ["學分數", "學分"])),
            "require_option": _row_value(row, ["必、選修", "必選修", "必修選修", "必選別"]),
            "teacher": _row_value(row, ["上課教師", "授課教師", "教師"]),
        }

    merged: list[dict[str, Any]] = []
    for course in registered_courses:
        course_no = str(course.get("course_no") or "").strip().upper()
        details = details_by_course_no.get(course_no, {})
        merged.append(
            {
                **course,
                "course_name": details.get("course_name") or course.get("course_name") or "",
                "credits": details.get("credits"),
                "require_option": details.get("require_option") or "",
                "teacher": details.get("teacher") or "",
            }
        )
    return merged


def _parse_schedule_table_rows(table: Tag | None) -> list[dict[str, str]]:
    rows = _extract_html_table_rows(table)
    if not rows:
        return []

    header_index = next(
        (index for index, row in enumerate(rows) if {"節次", "星期一"}.issubset(set(row))),
        0,
    )
    headers = rows[header_index]
    result: list[dict[str, str]] = []
    for cells in rows[header_index + 1:]:
        if not any(cells):
            continue
        if len(cells) >= len(OFFICIAL_SCHEDULE_HEADERS):
            result.append({
                OFFICIAL_SCHEDULE_HEADERS[index]: cells[index]
                for index in range(len(OFFICIAL_SCHEDULE_HEADERS))
            })
            continue
        result.append(
            {
                headers[index] if index < len(headers) and headers[index] else f"欄位{index + 1}": value
                for index, value in enumerate(cells)
            }
        )
    return result


def _parse_generic_table_rows(table: Tag | None) -> list[dict[str, str]]:
    rows = _extract_html_table_rows(table)
    if not rows:
        return []
    headers = rows[0]
    result: list[dict[str, str]] = []
    for cells in rows[1:]:
        if not any(cells):
            continue
        result.append(
            {
                headers[index] if index < len(headers) and headers[index] else f"欄位{index + 1}": value
                for index, value in enumerate(cells)
            }
        )
    return result


def _parse_notice_texts(soup: BeautifulSoup) -> list[str]:
    notices: list[str] = []
    for selector in [".alert", ".panel", ".well", "#message", "#Msg"]:
        for element in soup.select(selector):
            text = normalize(element.get_text(" ", strip=True))
            if text and text not in notices:
                notices.append(text)
    return notices[:10]


def _parse_action_response_notices(html: str) -> list[str]:
    if not html.strip():
        return []

    soup = BeautifulSoup(html, "html.parser")
    notices: list[str] = []
    selectors = [
        "#message",
        "#Msg",
        ".alert-danger",
        ".alert-warning",
        ".alert",
        ".modal-body",
        ".ui-dialog-content",
        ".swal2-html-container",
    ]
    for selector in selectors:
        for element in soup.select(selector):
            text = normalize(element.get_text(" ", strip=True))
            if text and text not in notices:
                notices.append(text)

    if notices:
        return notices[:5]

    body = soup.body or soup
    body_text = normalize(body.get_text(" ", strip=True))
    has_workspace_tables = bool(soup.select("#draggable, #cartTable, #loginModal, table, form"))
    if body_text and not has_workspace_tables and len(body_text) <= 300:
        return [body_text]
    return []


def _merge_unique_texts(primary: list[str], secondary: list[str]) -> list[str]:
    merged: list[str] = []
    for text in [*primary, *secondary]:
        normalized = normalize(str(text))
        if normalized and normalized not in merged:
            merged.append(normalized)
    return merged[:10]


def _extract_div_table_rows(container: Tag | None) -> list[list[str]]:
    if not isinstance(container, Tag):
        return []
    rows: list[list[str]] = []
    for row in container.select(".table-row"):
        if not isinstance(row, Tag):
            continue
        cells = [
            _clean_cell_text(cell)
            for cell in row.select(".table-cell")
            if isinstance(cell, Tag)
        ]
        if cells:
            rows.append(cells)
    return rows


def _extract_html_table_rows(table: Tag | None) -> list[list[str]]:
    if not isinstance(table, Tag):
        return []
    rows: list[list[str]] = []
    for tr in table.find_all("tr"):
        if not isinstance(tr, Tag):
            continue
        cells = [_clean_cell_text(cell) for cell in tr.find_all(["th", "td"]) if isinstance(cell, Tag)]
        if cells:
            rows.append(cells)
    return rows


def _find_table_containing(soup: BeautifulSoup, labels: list[str]) -> Tag | None:
    for table in soup.find_all("table"):
        if not isinstance(table, Tag):
            continue
        text = normalize(table.get_text(" ", strip=True))
        if all(label in text for label in labels):
            return table
    return None


def _drop_header_rows(rows: list[list[str]], expected_headers: set[str]) -> list[list[str]]:
    return [
        row
        for row in rows
        if len(expected_headers.intersection(set(row))) < 2
    ]


def _clean_cell_text(cell: Tag) -> str:
    lines = split_lines(cell.get_text("\n", strip=True))
    return normalize(" ".join(lines))


def _as_int(value: str) -> int | None:
    match = re.search(r"\d+", value)
    return int(match.group(0)) if match else None


def _as_float(value: str) -> float | None:
    match = re.search(r"\d+(?:\.\d+)?", value)
    return float(match.group(0)) if match else None


def _row_value(row: dict[str, str], aliases: list[str]) -> str:
    compact_aliases = {normalize(alias).replace(" ", "") for alias in aliases}
    for key, value in row.items():
        if normalize(key).replace(" ", "") in compact_aliases:
            return value
    return ""


def _is_auth_response(response: requests.Response) -> bool:
    url = response.url.lower()
    return "signin-oidc" in url or "ssoam" in url or "/login" in url or "account/login" in url
