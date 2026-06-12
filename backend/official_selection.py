from __future__ import annotations

import re
import threading
import time
from collections import deque
from typing import Any

import requests
from bs4 import BeautifulSoup, Tag

try:
    from .config import DEFAULT_TIMEOUT, INITIAL_SELECTION_URL
    from .ntust_common import login_to_target, normalize, requires_hidden_form_callback, split_lines, submit_hidden_form
    from .time_utils import now
except ImportError:  # pragma: no cover
    from config import DEFAULT_TIMEOUT, INITIAL_SELECTION_URL
    from ntust_common import login_to_target, normalize, requires_hidden_form_callback, split_lines, submit_hidden_form
    from time_utils import now


MIN_LOGIN_INTERVAL_SECONDS = 10
MAX_LOGINS_PER_MINUTE = 5
MAX_CLIENT_IDLE_SECONDS = 30 * 60

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
            return {
                **parse_a02_workspace(page_response.text),
                "source_url": page_response.url,
                "synced_at": now().isoformat(),
                "session_valid": True,
            }

    def ensure_session(self, username: str, password: str, verify_ssl: bool) -> requests.Response:
        if self._check_session_quick(verify_ssl):
            return self._get_workspace_page(verify_ssl)

        self._check_login_rate_limit()
        page_response = login_to_target(self.session, username, password, INITIAL_SELECTION_URL, verify_ssl)
        page_response = self._complete_callback_if_needed(page_response, verify_ssl)
        if _is_auth_response(page_response):
            raise RuntimeError(f"登入後無法進入初選登記頁，目前停在 {page_response.url}")

        self.is_logged_in = True
        self.last_login_at = time.time()
        self.login_times.append(self.last_login_at)
        return page_response

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


def parse_a02_workspace(html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    available = _parse_available_courses(soup)
    registered = _parse_registered_courses(soup)
    schedule_rows = _parse_generic_table_rows(soup.select_one("#loginModal table"))
    selection_list_rows = _parse_generic_table_rows(soup.select_one("#loginModal2 table"))
    required_preset_rows = _parse_generic_table_rows(soup.select_one("#DetermineTable"))

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
            }
        )
    return courses


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


def _is_auth_response(response: requests.Response) -> bool:
    url = response.url.lower()
    return "signin-oidc" in url or "ssoam" in url or "/login" in url or "account/login" in url
