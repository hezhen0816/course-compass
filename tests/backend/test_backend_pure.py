from __future__ import annotations

from datetime import datetime

import pytest
import requests
from fastapi.testclient import TestClient

from backend import app as backend_app
from backend.integrations import official_selection
from backend.integrations.schedule import find_latest_course_list_url, group_schedule_entries
from backend.repositories import credentials as credential_repository
from backend.repositories import school_sessions as school_session_repository
from backend.services import credential_store as credentials
from backend.services import school_session_store as school_sessions
from scripts import migrate_legacy_school_credentials as legacy_credential_migration
from scripts import verify_production_backend


class FakeJSONResponse:
    def __init__(self, payload: object) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> object:
        return self._payload


class FakeHTTPResponse:
    def __init__(self, text: str = "", url: str = "https://example.test/a02", status_code: int = 200) -> None:
        self.text = text
        self.url = url
        self.status_code = status_code

    def raise_for_status(self) -> None:
        return None


class FakeAuthResponse:
    def __init__(self, payload: object, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")

    def json(self) -> object:
        return self._payload


def test_group_schedule_entries_orders_slots_and_preserves_metadata() -> None:
    courses = [
        {
            "course_name": "資料結構",
            "required_type": "必修",
            "professor": "王小明",
        }
    ]
    slots = [
        {
            "weekday_key": "monday",
            "weekday_label": "星期一",
            "time": "09:10 - 10:00",
            "course_name": "資料結構",
            "location": "TR-312",
        },
        {
            "weekday_key": "monday",
            "weekday_label": "星期一",
            "time": "08:10 - 09:00",
            "course_name": "資料結構",
            "location": "TR-312",
        },
    ]

    entries = group_schedule_entries(courses, slots)

    assert entries == [
        {
            "weekday_key": "monday",
            "weekday_label": "星期一",
            "title": "資料結構",
            "time_range": "08:10 - 10:00",
            "slot_times": ["08:10 - 09:00", "09:10 - 10:00"],
            "room": "TR-312",
            "instructor": "王小明",
            "accent": "compulsory",
        }
    ]


def test_healthcheck_reports_official_selection_capabilities() -> None:
    client = TestClient(backend_app.app)

    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["version"] == backend_app.API_VERSION
    assert payload["capabilities"]["school_credentials"] is True
    assert payload["capabilities"]["school_sessions"] is True
    assert payload["capabilities"]["official_selection"] is True
    assert set(payload["capabilities"]["official_selection_actions"]) == {
        "sync",
        "keep_alive",
        "join",
        "add_to_waitlist",
        "remove",
        "reorder",
    }


def test_production_backend_verifier_accepts_required_capabilities(monkeypatch) -> None:
    def fake_fetch_json(url: str) -> dict[str, object]:
        if url.endswith("/health"):
            return {
                "ok": True,
                "capabilities": {
                    "school_credentials": True,
                    "school_sessions": True,
                    "official_selection": True,
                },
            }
        return {
            "paths": {
                path: {}
                for path in verify_production_backend.REQUIRED_OPENAPI_PATHS
            }
        }

    monkeypatch.setattr(verify_production_backend, "_fetch_json", fake_fetch_json)

    assert verify_production_backend.verify_backend("https://backend.example.test") == []


def test_production_backend_verifier_reports_missing_official_selection(monkeypatch) -> None:
    def fake_fetch_json(url: str) -> dict[str, object]:
        if url.endswith("/health"):
            return {"ok": True}
        return {"paths": {"/api/courses/search": {}}}

    monkeypatch.setattr(verify_production_backend, "_fetch_json", fake_fetch_json)

    issues = verify_production_backend.verify_backend("https://backend.example.test")

    assert "/health missing capabilities object" in issues
    assert "/openapi.json missing /api/official-selection/a02/sync" in issues
    assert "/openapi.json missing /api/school-credentials" in issues


def test_find_latest_course_list_url_prefers_highest_semester_list() -> None:
    html = """
    <a href="/ChooseList/D01/D01">選課清單</a>
    <a href="/ChooseList/D03/D03">選課清單(1151)</a>
    <a href="/ChooseList/D04/D04">選課清單(1142)</a>
    <a href="/ChooseList/D02/D02">暑期選課清單(1151)</a>
    """

    assert find_latest_course_list_url(
        html,
        "https://courseselection.ntust.edu.tw/ChooseList/D01/D01",
        "https://courseselection.ntust.edu.tw/ChooseList/D01/D01",
    ) == "https://courseselection.ntust.edu.tw/ChooseList/D03/D03"


def test_find_latest_course_list_url_falls_back_without_semester_link() -> None:
    fallback_url = "https://courseselection.ntust.edu.tw/ChooseList/D01/D01"

    assert find_latest_course_list_url(
        '<a href="/ChooseList/D01/D01">選課清單</a>',
        fallback_url,
        fallback_url,
    ) == fallback_url


def test_official_selection_parser_reads_a02_workspace_div_tables() -> None:
    html = """
    <html>
      <head><title>初選登記選課</title></head>
      <body>
        <div class="panel">請直接拖拉「登記志願清單」中的課程來變更志願序。</div>
        <div id="draggable">
          <div class="table-row">
            <div class="table-cell">課碼</div>
            <div class="table-cell">課程名稱</div>
            <div class="table-cell">上課教師</div>
            <div class="table-cell">加入登記</div>
          </div>
          <div class="table-row">
            <div class="table-cell">PE127A022</div>
            <div class="table-cell">體育(撞球)(上)</div>
            <div class="table-cell">蔡尚明</div>
            <div class="table-cell"><span class="addbtn btn">加入登記</span></div>
          </div>
        </div>
        <table id="cartTable">
          <tr><td>志願序</td><td>課碼</td><td>課程名稱</td><td>取消加入</td></tr>
          <tr><td>1</td><td>FE1581701</td><td>休閒英文</td><td>取消加入</td></tr>
        </table>
        <div id="loginModal">
          <table>
            <tr><th>節次</th><th>星期一</th><th>星期二</th></tr>
            <tr><td>1</td><td></td><td>休閒英文<br>TR-312</td></tr>
          </table>
        </div>
      </body>
    </html>
    """

    parsed = official_selection.parse_a02_workspace(html)

    assert parsed["page_title"] == "初選登記選課"
    assert parsed["available_courses"] == [
        {"course_no": "PE127A022", "course_name": "體育(撞球)(上)", "teacher": "蔡尚明"}
    ]
    assert parsed["registered_courses"] == [
        {
            "priority": 1,
            "course_no": "FE1581701",
            "course_name": "休閒英文",
            "raw_priority": "1",
            "credits": None,
            "require_option": "",
            "teacher": "",
        }
    ]
    assert parsed["schedule_rows"] == [{"節次": "1", "星期一": "", "星期二": "休閒英文 TR-312"}]
    assert parsed["notices"] == ["請直接拖拉「登記志願清單」中的課程來變更志願序。"]


def test_official_selection_parser_reads_action_modal_message() -> None:
    html = """
    <html>
      <body>
        <div class="modal-body">
          本門課設有選課班級條件，您不符合條件，無法選修。
        </div>
      </body>
    </html>
    """

    assert official_selection._parse_action_response_notices(html) == [
        "本門課設有選課班級條件，您不符合條件，無法選修。"
    ]


def test_official_selection_parser_prefers_action_error_over_announcements() -> None:
    html = """
    <html>
      <body>
        <div>訊息公告(點選可展開、收合) ※請直接拖拉「登記志願清單」中的課程來變更志願序。</div>
        <script>alert('本門課設有選課班級條件，您不符合條件，無法選修。');</script>
      </body>
    </html>
    """

    assert official_selection._parse_action_response_notices(html) == [
        "本門課設有選課班級條件，您不符合條件，無法選修。"
    ]


def test_official_selection_parser_expands_split_class_restriction_message() -> None:
    html = """
    <html>
      <body>
        <div class="panel">訊息公告(點選可展開、收合) ※請直接拖拉「登記志願清單」中的課程來變更志願序。</div>
        <div id="Msg">
          <span>本門課設有選課</span>
          <span>班級條件</span>
          <span>您不符合條件</span>
          <span>無法選修。</span>
        </div>
      </body>
    </html>
    """

    assert official_selection._parse_action_response_notices(html) == [
        "本門課設有選課班級條件，您不符合條件，無法選修。"
    ]


def test_official_selection_parser_keeps_full_script_alert_before_regex_fallback() -> None:
    html = """
    <html>
      <body>
        <script>alert("這門課遴選不開放選修，所以無法選修。");</script>
      </body>
    </html>
    """

    assert official_selection._parse_action_response_notices(html) == [
        "這門課遴選不開放選修，所以無法選修。"
    ]


def test_official_selection_parser_maps_schedule_weekday_columns_by_position() -> None:
    html = """
    <html>
      <body>
        <div id="loginModal">
          <table>
            <tr>
              <th>節次</th><th>時間</th><th>星期一</th><th>星期二</th><th>星期三</th>
              <th>星期四</th><th>星期五</th><th>星期六</th><th>星期日</th>
            </tr>
            <tr>
              <td>6</td><td>13:20～14:10</td><td></td><td>體育(撞球)(上)（1）</td><td></td>
              <td>數位系統設計</td><td></td><td></td><td></td>
            </tr>
            <tr>
              <td>7</td><td>14:20～15:10</td><td></td><td>體育(撞球)(上)（1）</td><td></td>
              <td>數位系統設計</td><td></td><td></td><td></td>
            </tr>
          </table>
        </div>
      </body>
    </html>
    """

    parsed = official_selection.parse_a02_workspace(html)

    assert parsed["schedule_rows"][0]["時間"] == "13:20～14:10"
    assert parsed["schedule_rows"][0]["星期二"] == "體育(撞球)(上)（1）"
    assert parsed["schedule_rows"][0]["星期四"] == "數位系統設計"
    assert parsed["schedule_rows"][1]["星期二"] == "體育(撞球)(上)（1）"


def test_official_selection_schedule_rows_from_synced_slots() -> None:
    rows = official_selection._schedule_rows_from_slots(
        [
            {
                "weekday_label": "星期二",
                "period": "6",
                "course_name": "體育(撞球)(上)",
            },
            {
                "weekday_label": "星期二",
                "period": "7",
                "course_name": "體育(撞球)(上)",
            },
            {
                "weekday_label": "星期四",
                "period": "6",
                "course_name": "數位系統設計",
            },
        ]
    )

    assert rows[5]["節次"] == "6"
    assert rows[5]["星期二"] == "體育(撞球)(上)"
    assert rows[5]["星期四"] == "數位系統設計"
    assert rows[6]["星期二"] == "體育(撞球)(上)"


def test_official_selection_workspace_prefers_course_list_schedule_when_a02_schedule_differs(monkeypatch) -> None:
    html = """
    <html>
      <body>
        <div id="loginModal">
          <table>
            <tr>
              <th>節次</th><th>時間</th><th>星期一</th><th>星期二</th><th>星期三</th>
              <th>星期四</th><th>星期五</th><th>星期六</th><th>星期日</th>
            </tr>
            <tr>
              <td>2</td><td>9:10～10:00</td><td></td><td>數位系統設計</td><td>數位系統設計</td>
              <td></td><td></td><td></td><td></td>
            </tr>
          </table>
        </div>
      </body>
    </html>
    """
    course_list_rows = official_selection._schedule_rows_from_slots(
        [
            {
                "weekday_label": "星期四",
                "period": "6",
                "course_name": "數位系統設計",
            },
            {
                "weekday_label": "星期四",
                "period": "7",
                "course_name": "數位系統設計",
            },
        ]
    )

    client = official_selection.OfficialSelectionClient()
    monkeypatch.setattr(client, "_fetch_course_list_schedule_rows", lambda verify_ssl: course_list_rows)

    payload = client._workspace_payload(FakeHTTPResponse(text=html), verify_ssl=False)

    assert payload["schedule_rows"][1]["星期二"] == ""
    assert payload["schedule_rows"][1]["星期三"] == ""
    assert payload["schedule_rows"][5]["星期四"] == "數位系統設計"
    assert payload["schedule_rows"][6]["星期四"] == "數位系統設計"
    assert "官方功課表由正式課程清單校正。" in payload["notices"]


def test_official_selection_arraydata_form_rows_matches_saveidx_shape() -> None:
    rows = official_selection._arraydata_form_rows(
        [
            ["志願序", "課碼", "課程名稱", "取消加入"],
            ["1", "PE127A022", "體育(撞球)(上)", "取消加入"],
        ]
    )

    assert rows == [
        ("Arraydata[0][0]", "志願序"),
        ("Arraydata[0][1]", "課碼"),
        ("Arraydata[0][2]", "課程名稱"),
        ("Arraydata[0][3]", "取消加入"),
        ("Arraydata[1][0]", "1"),
        ("Arraydata[1][1]", "PE127A022"),
        ("Arraydata[1][2]", "體育(撞球)(上)"),
        ("Arraydata[1][3]", "取消加入"),
    ]


def test_official_selection_client_exports_and_restores_session_cookies() -> None:
    client = official_selection.OfficialSelectionClient()
    client.session.cookies.set(
        "OfficialSelection.Auth",
        "cookie-secret",
        domain="courseselection.ntust.edu.tw",
        path="/",
    )
    client.is_logged_in = True

    restored = official_selection.OfficialSelectionClient()

    assert restored.restore_session_state(client.export_session_state()) is True
    assert (
        restored.session.cookies.get(
            "OfficialSelection.Auth",
            domain="courseselection.ntust.edu.tw",
            path="/",
        )
        == "cookie-secret"
    )
    assert restored.is_logged_in is True


def test_official_selection_join_refreshes_workspace_before_and_after_post(monkeypatch) -> None:
    events: list[object] = []
    workspace_html = """
    <html>
      <head><title>初選登記選課</title></head>
      <body>
        <table id="cartTable">
          <tr><td>志願序</td><td>課碼</td><td>課程名稱</td><td>取消加入</td></tr>
          <tr><td>1</td><td>CS2002302</td><td>資料結構</td><td>取消加入</td></tr>
        </table>
        <div id="loginModal">
          <table>
            <tr><th>節次</th><th>時間</th><th>星期一</th><th>星期二</th></tr>
            <tr><td>1</td><td>08:10～09:00</td><td>資料結構</td><td></td></tr>
          </table>
        </div>
      </body>
    </html>
    """

    class FakeSession:
        def __init__(self) -> None:
            self.headers: dict[str, str] = {}

        def post(self, endpoint: str, **kwargs: object) -> FakeHTTPResponse:
            events.append(("post", endpoint, kwargs["data"]))
            return FakeHTTPResponse(url=endpoint)

    client = official_selection.OfficialSelectionClient()
    client.session = FakeSession()  # type: ignore[assignment]

    def fake_get_workspace_page(verify_ssl: bool) -> FakeHTTPResponse:
        events.append(("get_workspace", verify_ssl))
        return FakeHTTPResponse(text=workspace_html)

    monkeypatch.setattr(client, "_get_workspace_page", fake_get_workspace_page)
    monkeypatch.setattr(client, "_fetch_course_list_schedule_rows", lambda verify_ssl: [])

    payload = client.join_course(" cs2002302 ", verify_ssl=False)

    assert events == [
        ("get_workspace", False),
        (
            "post",
            official_selection.INITIAL_SELECTION_JOIN_URL,
            {"CourseNo": "CS2002302", "type": 1},
        ),
        ("get_workspace", False),
    ]
    assert payload["session_valid"] is True
    assert payload["registered_courses"][0]["course_no"] == "CS2002302"


def test_official_selection_waitlist_uses_single_add_endpoint(monkeypatch) -> None:
    events: list[object] = []
    workspace_html = """
    <html>
      <body>
        <div id="draggable"></div>
        <table id="cartTable">
          <tr><td>志願序</td><td>課碼</td><td>課程名稱</td><td>取消加入</td></tr>
        </table>
      </body>
    </html>
    """

    class FakeSession:
        def __init__(self) -> None:
            self.headers: dict[str, str] = {}

        def post(self, endpoint: str, **kwargs: object) -> FakeHTTPResponse:
            events.append(("post", endpoint, kwargs["data"]))
            return FakeHTTPResponse(url=endpoint)

    client = official_selection.OfficialSelectionClient()
    client.session = FakeSession()  # type: ignore[assignment]

    def fake_get_workspace_page(verify_ssl: bool) -> FakeHTTPResponse:
        events.append(("get_workspace", verify_ssl))
        return FakeHTTPResponse(text=workspace_html)

    monkeypatch.setattr(client, "_get_workspace_page", fake_get_workspace_page)
    monkeypatch.setattr(client, "_fetch_course_list_schedule_rows", lambda verify_ssl: [])

    client.add_course_to_waitlist(" ba2208302 ", verify_ssl=False)

    assert events == [
        ("get_workspace", False),
        (
            "post",
            official_selection.INITIAL_SELECTION_EXTRA_JOIN_URL,
            {"CourseNo": "BA2208302", "type": 3},
        ),
        ("get_workspace", False),
    ]


def test_official_selection_join_preserves_action_rejection_notice(monkeypatch) -> None:
    events: list[object] = []
    workspace_html = """
    <html>
      <body>
        <div class="panel">請直接拖拉「登記志願清單」中的課程來變更志願序。</div>
        <div id="draggable">
          <div class="table-row">
            <div class="table-cell">課碼</div>
            <div class="table-cell">課程名稱</div>
            <div class="table-cell">上課教師</div>
            <div class="table-cell">加入登記</div>
          </div>
          <div class="table-row">
            <div class="table-cell">PE139A021</div>
            <div class="table-cell">體育(重量訓練)(上)</div>
            <div class="table-cell">翁睿忻</div>
            <div class="table-cell">加入登記</div>
          </div>
        </div>
      </body>
    </html>
    """
    rejection_html = """
    <html>
      <body>
        <div class="modal-body">本門課設有選課班級條件，您不符合條件，無法選修。</div>
      </body>
    </html>
    """

    class FakeSession:
        def __init__(self) -> None:
            self.headers: dict[str, str] = {}

        def post(self, endpoint: str, **kwargs: object) -> FakeHTTPResponse:
            events.append(("post", endpoint, kwargs["data"]))
            return FakeHTTPResponse(text=rejection_html, url=endpoint)

    client = official_selection.OfficialSelectionClient()
    client.session = FakeSession()  # type: ignore[assignment]

    def fake_get_workspace_page(verify_ssl: bool) -> FakeHTTPResponse:
        events.append(("get_workspace", verify_ssl))
        return FakeHTTPResponse(text=workspace_html)

    monkeypatch.setattr(client, "_get_workspace_page", fake_get_workspace_page)
    monkeypatch.setattr(client, "_fetch_course_list_schedule_rows", lambda verify_ssl: [])

    payload = client.join_course("pe139a021", verify_ssl=False)

    assert events == [
        ("get_workspace", False),
        (
            "post",
            official_selection.INITIAL_SELECTION_JOIN_URL,
            {"CourseNo": "PE139A021", "type": 1},
        ),
        ("get_workspace", False),
    ]
    assert payload["notices"][0] == "本門課設有選課班級條件，您不符合條件，無法選修。"
    assert payload["notices"][1] == "請直接拖拉「登記志願清單」中的課程來變更志願序。"


def test_official_selection_join_reads_rejection_notice_from_refreshed_workspace(monkeypatch) -> None:
    events: list[object] = []
    workspace_html = """
    <html>
      <body>
        <div class="panel">訊息公告(點選可展開、收合) ※請直接拖拉「登記志願清單」中的課程來變更志願序。</div>
        <script>alert('本門課設有選課班級條件，您不符合條件，無法選修。');</script>
        <div id="draggable">
          <div class="table-row">
            <div class="table-cell">課碼</div>
            <div class="table-cell">課程名稱</div>
            <div class="table-cell">上課教師</div>
            <div class="table-cell">加入登記</div>
          </div>
          <div class="table-row">
            <div class="table-cell">BA2208302</div>
            <div class="table-cell">成本會計</div>
            <div class="table-cell">郭啟賢</div>
            <div class="table-cell">加入登記</div>
          </div>
        </div>
      </body>
    </html>
    """

    class FakeSession:
        def __init__(self) -> None:
            self.headers: dict[str, str] = {}

        def post(self, endpoint: str, **kwargs: object) -> FakeHTTPResponse:
            events.append(("post", endpoint, kwargs["data"]))
            return FakeHTTPResponse(text="", url=endpoint)

    client = official_selection.OfficialSelectionClient()
    client.session = FakeSession()  # type: ignore[assignment]

    def fake_get_workspace_page(verify_ssl: bool) -> FakeHTTPResponse:
        events.append(("get_workspace", verify_ssl))
        return FakeHTTPResponse(text=workspace_html)

    monkeypatch.setattr(client, "_get_workspace_page", fake_get_workspace_page)
    monkeypatch.setattr(client, "_fetch_course_list_schedule_rows", lambda verify_ssl: [])

    payload = client.join_course("ba2208302", verify_ssl=False)

    assert events == [
        ("get_workspace", False),
        (
            "post",
            official_selection.INITIAL_SELECTION_JOIN_URL,
            {"CourseNo": "BA2208302", "type": 1},
        ),
        ("get_workspace", False),
    ]
    assert payload["notices"][0] == "本門課設有選課班級條件，您不符合條件，無法選修。"


def test_official_selection_action_uses_saved_credentials_for_session(monkeypatch) -> None:
    calls: list[tuple[str, str, str, bool] | tuple[str, str]] = []

    class FakeOfficialSelectionClient:
        def keep_alive(self, verify_ssl: bool) -> bool:
            return False

        def ensure_session(self, username: str, password: str, verify_ssl: bool) -> None:
            calls.append(("ensure_session", username, password, verify_ssl))

        def export_session_state(self) -> dict[str, object]:
            return {"cookies": [{"name": "session", "value": "saved"}]}

        def add_course_to_waitlist(self, course_no: str, verify_ssl: bool) -> dict[str, object]:
            calls.append(("add_course_to_waitlist", course_no))
            return {
                "source_url": "https://example.test/a02",
                "page_title": "初選登記選課",
                "synced_at": "2026-06-13T10:00:00+08:00",
                "session_valid": True,
                "available_count": 0,
                "registered_count": 1,
                "available_courses": [],
                "registered_courses": [
                    {
                        "priority": 1,
                        "raw_priority": "1",
                        "course_no": course_no,
                        "course_name": "資料結構",
                    }
                ],
                "schedule_rows": [],
                "selection_list_rows": [],
                "required_preset_rows": [],
                "notices": [],
            }

    monkeypatch.setattr(backend_app, "_authorization_context", lambda authorization: ("user-1", "token-1"))
    monkeypatch.setattr(
        backend_app,
        "get_school_credentials_secret",
        lambda user_id, access_token: {
            "username": "B11430207",
            "password": "saved-password",
            "hasPassword": True,
        },
    )
    monkeypatch.setattr(backend_app, "get_official_selection_client", lambda profile_key: FakeOfficialSelectionClient())
    monkeypatch.setattr(backend_app, "load_school_session_state", lambda user_id, username: None)
    monkeypatch.setattr(backend_app, "save_school_session_state", lambda *args, **kwargs: None)
    client = TestClient(backend_app.app)

    response = client.post(
        "/api/official-selection/a02/add-to-waitlist",
        headers={"Authorization": "Bearer token-1"},
        json={
            "username": "B11430207",
            "course_no": "CS2002302",
            "confirmed": True,
            "profile_key": "B11430207",
            "verify_ssl": False,
        },
    )

    assert response.status_code == 200
    assert response.json()["registered_courses"][0]["course_no"] == "CS2002302"
    assert calls == [
        ("ensure_session", "B11430207", "saved-password", False),
        ("add_course_to_waitlist", "CS2002302"),
    ]


def test_official_selection_sync_restores_saved_session_without_password(monkeypatch) -> None:
    calls: list[str] = []

    class FakeOfficialSelectionClient:
        restored = False

        def keep_alive(self, verify_ssl: bool) -> bool:
            calls.append(f"keep_alive:{self.restored}")
            return self.restored

        def restore_session_state(self, session_state: dict[str, object]) -> bool:
            calls.append("restore_session_state")
            self.restored = True
            return True

        def fetch_current_a02_workspace(self, verify_ssl: bool) -> dict[str, object]:
            calls.append("fetch_current_a02_workspace")
            return {
                "source_url": "https://example.test/a02",
                "page_title": "初選登記選課",
                "synced_at": "2026-06-13T10:00:00+08:00",
                "session_valid": True,
                "available_count": 0,
                "registered_count": 0,
                "available_courses": [],
                "registered_courses": [],
                "schedule_rows": [],
                "selection_list_rows": [],
                "required_preset_rows": [],
                "notices": [],
            }

        def export_session_state(self) -> dict[str, object]:
            return {"cookies": [{"name": "session", "value": "restored"}]}

    def fail_if_credentials_used(user_id: str, access_token: str) -> dict[str, object]:
        raise AssertionError("saved password should not be needed when DB session is valid")

    monkeypatch.setattr(backend_app, "_authorization_context", lambda authorization: ("user-1", "token-1"))
    monkeypatch.setattr(backend_app, "get_school_credentials_secret", fail_if_credentials_used)
    monkeypatch.setattr(backend_app, "get_official_selection_client", lambda profile_key: FakeOfficialSelectionClient())
    monkeypatch.setattr(
        backend_app,
        "load_school_session_state",
        lambda user_id, username: {"session_state": {"cookies": [{"name": "session", "value": "restored"}]}},
    )
    monkeypatch.setattr(backend_app, "save_school_session_state", lambda *args, **kwargs: None)
    client = TestClient(backend_app.app)

    response = client.post(
        "/api/official-selection/a02/sync",
        headers={"Authorization": "Bearer token-1"},
        json={
            "username": "B11430207",
            "profile_key": "B11430207",
            "verify_ssl": False,
        },
    )

    assert response.status_code == 200
    assert response.json()["session_valid"] is True
    assert calls == [
        "keep_alive:False",
        "restore_session_state",
        "keep_alive:True",
        "fetch_current_a02_workspace",
    ]


def test_official_selection_action_requires_explicit_confirmation(monkeypatch) -> None:
    client_called = False

    def fail_if_client_created(profile_key: str) -> object:
        nonlocal client_called
        client_called = True
        raise AssertionError("official client should not be created without confirmation")

    monkeypatch.setattr(backend_app, "get_official_selection_client", fail_if_client_created)
    client = TestClient(backend_app.app)

    response = client.post(
        "/api/official-selection/a02/add-to-waitlist",
        json={
            "username": "B11430207",
            "course_no": "CS2002302",
            "profile_key": "B11430207",
            "verify_ssl": False,
        },
    )

    assert response.status_code == 400
    assert "明確確認" in response.json()["detail"]
    assert client_called is False


def test_schedule_sync_uses_saved_credentials_without_request_password(monkeypatch) -> None:
    calls: list[tuple[str, str, bool]] = []

    monkeypatch.setattr(backend_app, "_authorization_context", lambda authorization: ("user-1", "token-1"))
    monkeypatch.setattr(
        backend_app,
        "get_school_credentials_secret",
        lambda user_id, access_token: {
            "username": "B11430207",
            "password": "saved-password",
            "hasPassword": True,
        },
    )

    def fake_fetch_schedule(username: str, password: str, verify_ssl: bool) -> dict[str, object]:
        calls.append((username, password, verify_ssl))
        return {
            "source_url": "https://example.test/schedule",
            "page_title": "選課清單",
            "total_credits_text": "0",
            "total_credits": 0,
            "courses": [],
            "slots": [],
            "schedule_entries": [],
        }

    monkeypatch.setattr(backend_app, "fetch_schedule", fake_fetch_schedule)
    client = TestClient(backend_app.app)

    response = client.post(
        "/api/schedule/sync",
        headers={"Authorization": "Bearer token-1"},
        json={
            "username": "B11430207",
            "profile_key": "B11430207",
            "persist_to_supabase": False,
            "verify_ssl": False,
        },
    )

    assert response.status_code == 200
    assert response.json()["school_account"] == "B11430207"
    assert calls == [("B11430207", "saved-password", False)]


def test_schedule_sync_requires_password_or_saved_credentials(monkeypatch) -> None:
    fetch_called = False

    def fake_fetch_schedule(username: str, password: str, verify_ssl: bool) -> dict[str, object]:
        nonlocal fetch_called
        fetch_called = True
        raise AssertionError("schedule fetch should not run without a password")

    monkeypatch.setattr(backend_app, "fetch_schedule", fake_fetch_schedule)
    client = TestClient(backend_app.app)

    response = client.post(
        "/api/schedule/sync",
        json={
            "username": "B11430207",
            "profile_key": "B11430207",
            "persist_to_supabase": False,
            "verify_ssl": False,
        },
    )

    assert response.status_code == 400
    assert "校務密碼" in response.json()["detail"]
    assert fetch_called is False


def test_history_import_uses_saved_credentials_without_request_password(monkeypatch) -> None:
    calls: list[tuple[str, str, bool]] = []

    monkeypatch.setattr(backend_app, "_authorization_context", lambda authorization: ("user-1", "token-1"))
    monkeypatch.setattr(
        backend_app,
        "get_school_credentials_secret",
        lambda user_id, access_token: {
            "username": "B11430207",
            "password": "saved-password",
            "hasPassword": True,
        },
    )

    def fake_fetch_history_records(username: str, password: str, verify_ssl: bool) -> dict[str, object]:
        calls.append((username, password, verify_ssl))
        return {
            "source_url": "https://example.test/history",
            "page_title": "歷年成績",
            "student_name": "賀震",
            "student_no": username,
            "department": "",
            "status": "",
            "summary_texts": [],
            "records": [],
        }

    monkeypatch.setattr(backend_app, "fetch_history_records", fake_fetch_history_records)
    client = TestClient(backend_app.app)

    response = client.post(
        "/api/history/import",
        headers={"Authorization": "Bearer token-1"},
        json={
            "username": "B11430207",
            "profile_key": "B11430207",
            "persist_to_supabase": False,
            "verify_ssl": False,
        },
    )

    assert response.status_code == 200
    assert response.json()["student_no"] == "B11430207"
    assert calls == [("B11430207", "saved-password", False)]


def test_moodle_sync_uses_saved_credentials_without_request_password(monkeypatch) -> None:
    calls: list[tuple[str, str, bool]] = []

    monkeypatch.setattr(backend_app, "_authorization_context", lambda authorization: ("user-1", "token-1"))
    monkeypatch.setattr(
        backend_app,
        "get_school_credentials_secret",
        lambda user_id, access_token: {
            "username": "B11430207",
            "password": "saved-password",
            "hasPassword": True,
        },
    )

    def fake_fetch_moodle_assignments(username: str, password: str, verify_ssl: bool) -> dict[str, object]:
        calls.append((username, password, verify_ssl))
        return {
            "source_url": "https://example.test/moodle",
            "page_title": "Moodle",
            "timeline_filter": "未來",
            "items": [],
        }

    monkeypatch.setattr(backend_app, "fetch_moodle_assignments", fake_fetch_moodle_assignments)
    client = TestClient(backend_app.app)

    response = client.post(
        "/api/moodle/assignments/sync",
        headers={"Authorization": "Bearer token-1"},
        json={
            "username": "B11430207",
            "profile_key": "B11430207",
            "persist_to_supabase": False,
            "verify_ssl": False,
        },
    )

    assert response.status_code == 200
    assert response.json()["timeline_filter"] == "未來"
    assert calls == [("B11430207", "saved-password", False)]


def test_school_credentials_status_reads_private_rpc_without_password(monkeypatch) -> None:
    monkeypatch.setattr(credentials, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(credentials, "SUPABASE_SERVICE_ROLE_KEY", "service-role-key")

    def fake_post(url: str, headers: dict[str, str], json: dict[str, str], timeout: int) -> FakeJSONResponse:
        assert url == "https://example.supabase.co/rest/v1/rpc/get_school_credentials"
        assert json == {"p_user_id": "user-1"}
        return FakeJSONResponse(
            [
                {
                    "school_account": "B11430207",
                    "password_ciphertext": "encrypted-password",
                    "key_version": 1,
                    "last_verified_at": "2026-06-13T02:00:00Z",
                }
            ]
        )

    monkeypatch.setattr(credentials.requests, "post", fake_post)

    assert credentials.get_school_credentials_status("user-1", "access-token") == {
        "username": "B11430207",
        "hasPassword": True,
    }


def test_school_credentials_secret_decrypts_private_rpc(monkeypatch) -> None:
    monkeypatch.setattr(credentials, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(credentials, "SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    monkeypatch.setattr(credentials, "decrypt_school_password", lambda token: f"plain:{token}")
    monkeypatch.setattr(
        credentials.requests,
        "post",
        lambda url, headers, json, timeout: FakeJSONResponse(
            [
                {
                    "school_account": "B11430207",
                    "password_ciphertext": "encrypted-password",
                    "key_version": 1,
                    "last_verified_at": "2026-06-13T02:00:00Z",
                }
            ]
        ),
    )

    assert credentials.get_school_credentials_secret("user-1", "access-token") == {
        "username": "B11430207",
        "password": "plain:encrypted-password",
        "hasPassword": True,
    }


def test_school_credentials_writes_and_deletes_private_rpc(monkeypatch) -> None:
    calls: list[tuple[str, dict[str, object]]] = []

    def fake_post(url: str, headers: dict[str, str], json: dict[str, object], timeout: int) -> FakeJSONResponse:
        calls.append((url, json))
        return FakeJSONResponse(None)

    monkeypatch.setattr(credentials, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(credentials, "SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    monkeypatch.setattr(credentials.requests, "post", fake_post)

    credentials._upsert_school_credentials_row("user-1", "B11430207", "encrypted-password")
    credentials._delete_school_credentials_row("user-1")

    assert calls[0][0] == "https://example.supabase.co/rest/v1/rpc/upsert_school_credentials"
    assert calls[0][1]["p_user_id"] == "user-1"
    assert calls[0][1]["p_school_account"] == "B11430207"
    assert calls[0][1]["p_password_ciphertext"] == "encrypted-password"
    assert calls[1] == (
        "https://example.supabase.co/rest/v1/rpc/delete_school_credentials",
        {"p_user_id": "user-1"},
    )


def test_school_credentials_repository_writes_expected_rpc_payload() -> None:
    calls: list[tuple[str, dict[str, object], dict[str, str], int]] = []

    class FakeRPCResponse:
        def raise_for_status(self) -> None:
            return None

    def fake_post(url: str, headers: dict[str, str], json: dict[str, object], timeout: int) -> FakeRPCResponse:
        calls.append((url, json, headers, timeout))
        return FakeRPCResponse()

    credential_repository.upsert_school_credentials_row(
        "user-1",
        "B11430207",
        "encrypted-password",
        key_version=1,
        last_verified_at="2026-06-13T02:00:00+00:00",
        supabase_url="https://example.supabase.co",
        timeout=12,
        service_role_headers=lambda json_body=False: {"Authorization": f"json={json_body}"},
        post=fake_post,
    )

    assert calls == [
        (
            "https://example.supabase.co/rest/v1/rpc/upsert_school_credentials",
            {
                "p_user_id": "user-1",
                "p_school_account": "B11430207",
                "p_password_ciphertext": "encrypted-password",
                "p_key_version": 1,
                "p_last_verified_at": "2026-06-13T02:00:00+00:00",
            },
            {"Authorization": "json=True"},
            12,
        )
    ]


def test_resolve_user_id_validates_token_with_supabase_auth(monkeypatch) -> None:
    calls: list[tuple[str, dict[str, str]]] = []

    def fake_get(url: str, headers: dict[str, str], timeout: int) -> FakeAuthResponse:
        calls.append((url, headers))
        return FakeAuthResponse({"id": "user-1"})

    monkeypatch.setattr(credentials, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(credentials, "SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setattr(credentials, "SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    monkeypatch.setattr(credentials.requests, "get", fake_get)

    assert credentials.resolve_user_id("access-token") == "user-1"
    assert calls == [
        (
            "https://example.supabase.co/auth/v1/user",
            {
                "apikey": "anon-key",
                "Authorization": "Bearer access-token",
                "Accept": "application/json",
            },
        )
    ]


def test_credential_repository_loads_user_content() -> None:
    calls: list[tuple[str, dict[str, str], int]] = []

    class FakeUserDataResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> object:
            return [{"content": {"schemaVersion": 2, "settings": {"school_account": "B11430207"}}}]

    def fake_get(url: str, headers: dict[str, str], timeout: int) -> FakeUserDataResponse:
        calls.append((url, headers, timeout))
        return FakeUserDataResponse()

    content = credential_repository.load_user_content(
        "user/1",
        supabase_url="https://example.supabase.co",
        headers={"Authorization": "Bearer token"},
        timeout=12,
        get=fake_get,
    )

    assert calls == [
        (
            "https://example.supabase.co/rest/v1/user_data?user_id=eq.user%2F1&select=content",
            {"Authorization": "Bearer token"},
            12,
        )
    ]
    assert content == {"schemaVersion": 2, "settings": {"school_account": "B11430207"}}


def test_credential_repository_saves_user_content() -> None:
    calls: list[tuple[str, dict[str, str], dict[str, object], int]] = []

    class FakeUserDataResponse:
        def raise_for_status(self) -> None:
            return None

    def fake_post(url: str, headers: dict[str, str], json: dict[str, object], timeout: int) -> FakeUserDataResponse:
        calls.append((url, headers, json, timeout))
        return FakeUserDataResponse()

    credential_repository.save_user_content(
        "user-1",
        {"schemaVersion": 2, "settings": {}},
        supabase_url="https://example.supabase.co",
        headers={"Authorization": "Bearer token"},
        timeout=12,
        updated_at="2026-06-14T13:00:00+00:00",
        post=fake_post,
    )

    assert calls == [
        (
            "https://example.supabase.co/rest/v1/user_data?on_conflict=user_id",
            {"Authorization": "Bearer token"},
            {
                "user_id": "user-1",
                "content": {"schemaVersion": 2, "settings": {}},
                "content_version": 2,
                "last_writer": "backend",
                "updated_at": "2026-06-14T13:00:00+00:00",
            },
            12,
        )
    ]


def test_credential_repository_lists_user_content_rows() -> None:
    calls: list[tuple[str, dict[str, str], int]] = []

    class FakeUserDataResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> object:
            return [{"user_id": "user-1", "content": {"settings": {}}}]

    def fake_get(url: str, headers: dict[str, str], timeout: int) -> FakeUserDataResponse:
        calls.append((url, headers, timeout))
        return FakeUserDataResponse()

    rows = credential_repository.list_user_data_content_rows(
        supabase_url="https://example.supabase.co",
        headers={"Authorization": "Bearer service"},
        timeout=12,
        get=fake_get,
    )

    assert calls == [
        (
            "https://example.supabase.co/rest/v1/user_data?select=user_id,content",
            {"Authorization": "Bearer service"},
            12,
        )
    ]
    assert rows == [{"user_id": "user-1", "content": {"settings": {}}}]


def test_resolve_user_id_rejects_invalid_supabase_auth_token(monkeypatch) -> None:
    monkeypatch.setattr(credentials, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(credentials, "SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setattr(
        credentials.requests,
        "get",
        lambda url, headers, timeout: FakeAuthResponse({"message": "invalid jwt"}, status_code=401),
    )

    with pytest.raises(credentials.CredentialStoreError, match="登入狀態已過期或無效"):
        credentials.resolve_user_id("not-a-real-jwt")


def test_resolve_user_id_can_use_service_role_apikey_when_anon_missing(monkeypatch) -> None:
    captured_headers: list[dict[str, str]] = []

    def fake_get(url: str, headers: dict[str, str], timeout: int) -> FakeAuthResponse:
        captured_headers.append(headers)
        return FakeAuthResponse({"id": "user-1"})

    monkeypatch.setattr(credentials, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(credentials, "SUPABASE_ANON_KEY", "your-anon-key")
    monkeypatch.setattr(credentials, "SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    monkeypatch.setattr(credentials.requests, "get", fake_get)

    assert credentials.resolve_user_id("access-token") == "user-1"
    assert captured_headers[0]["apikey"] == "service-role-key"
    assert captured_headers[0]["Authorization"] == "Bearer access-token"


def test_school_credentials_rejects_placeholder_encryption_secret(monkeypatch) -> None:
    monkeypatch.setattr(
        credentials,
        "SCHOOL_CREDENTIALS_ENCRYPTION_SECRET",
        "replace-with-openssl-rand-hex-32",
    )

    with pytest.raises(credentials.CredentialStoreError, match="尚未設定校務帳密加密金鑰"):
        credentials.encrypt_school_password("password")


def test_school_credentials_rejects_short_encryption_secret(monkeypatch) -> None:
    monkeypatch.setattr(credentials, "SCHOOL_CREDENTIALS_ENCRYPTION_SECRET", "short-secret")

    with pytest.raises(credentials.CredentialStoreError, match="至少 32 字元"):
        credentials.encrypt_school_password("password")


def test_school_credentials_encryption_round_trip(monkeypatch) -> None:
    monkeypatch.setattr(credentials, "SCHOOL_CREDENTIALS_ENCRYPTION_SECRET", "x" * 32)

    token = credentials.encrypt_school_password("saved-password")

    assert token != "saved-password"
    assert credentials.decrypt_school_password(token) == "saved-password"


def test_school_session_store_round_trip_uses_service_role_rpc(monkeypatch) -> None:
    calls: list[tuple[str, dict[str, object]]] = []

    class FakeRPCResponse:
        def __init__(self, payload: object) -> None:
            self._payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self) -> object:
            return self._payload

    def fake_post(url: str, headers: dict[str, str], json: dict[str, object], timeout: int) -> FakeRPCResponse:
        calls.append((url, json))
        if url.endswith("/get_school_session"):
            return FakeRPCResponse(
                [
                    {
                        "school_account": "B11430207",
                        "session_ciphertext": "encrypted-session",
                        "key_version": 1,
                        "expires_at": "2026-06-13T04:00:00Z",
                        "last_keep_alive_at": "2026-06-13T03:30:00Z",
                    }
                ]
            )
        return FakeRPCResponse(None)

    monkeypatch.setattr(school_sessions, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(school_sessions, "_service_role_headers", lambda json_body=False: {"Authorization": "Bearer service"})
    monkeypatch.setattr(school_sessions, "encrypt_school_session_state", lambda state: "encrypted-session")
    monkeypatch.setattr(
        school_sessions,
        "decrypt_school_session_state",
        lambda ciphertext: {"cookies": [{"name": "session", "value": "restored"}]},
    )
    monkeypatch.setattr(school_sessions.requests, "post", fake_post)

    school_sessions.save_school_session_state(
        "00000000-0000-0000-0000-000000000001",
        "B11430207",
        {"cookies": [{"name": "session", "value": "secret"}]},
    )
    loaded = school_sessions.load_school_session_state(
        "00000000-0000-0000-0000-000000000001",
        "B11430207",
    )

    assert calls[0][0] == "https://example.supabase.co/rest/v1/rpc/upsert_school_session"
    assert calls[0][1]["p_school_account"] == "B11430207"
    assert calls[0][1]["p_session_ciphertext"] == "encrypted-session"
    assert calls[1][0] == "https://example.supabase.co/rest/v1/rpc/get_school_session"
    assert loaded == {
        "school_account": "B11430207",
        "session_state": {"cookies": [{"name": "session", "value": "restored"}]},
        "expires_at": "2026-06-13T04:00:00Z",
        "last_keep_alive_at": "2026-06-13T03:30:00Z",
    }


def test_school_session_repository_writes_expected_rpc_payload() -> None:
    calls: list[tuple[str, dict[str, object], dict[str, str], int]] = []

    class FakeRPCResponse:
        def raise_for_status(self) -> None:
            return None

    def fake_post(url: str, headers: dict[str, str], json: dict[str, object], timeout: int) -> FakeRPCResponse:
        calls.append((url, json, headers, timeout))
        return FakeRPCResponse()

    school_session_repository.save_school_session_row(
        "00000000-0000-0000-0000-000000000001",
        " B11430207 ",
        "encrypted-session",
        expires_at="2026-06-13T04:00:00Z",
        last_keep_alive_at="2026-06-13T03:30:00Z",
        supabase_url="https://example.supabase.co",
        timeout=12,
        service_role_headers=lambda json_body=False: {"Authorization": f"json={json_body}"},
        post=fake_post,
    )

    assert calls == [
        (
            "https://example.supabase.co/rest/v1/rpc/upsert_school_session",
            {
                "p_user_id": "00000000-0000-0000-0000-000000000001",
                "p_school_account": "B11430207",
                "p_session_ciphertext": "encrypted-session",
                "p_expires_at": "2026-06-13T04:00:00Z",
                "p_last_keep_alive_at": "2026-06-13T03:30:00Z",
            },
            {"Authorization": "json=True"},
            12,
        )
    ]


def test_school_credentials_status_reads_legacy_plaintext_password(monkeypatch) -> None:
    monkeypatch.setattr(credentials, "_load_school_credentials_row", lambda user_id: None)
    monkeypatch.setattr(
        credentials,
        "load_user_content",
        lambda user_id, access_token: {
            "settings": {
                "school_account": "B11430207",
                "school_password": "legacy-password",
            }
        },
    )

    assert credentials.get_school_credentials_status("user-1", "access-token") == {
        "username": "B11430207",
        "hasPassword": True,
    }


def test_school_credentials_secret_promotes_legacy_plaintext_password(monkeypatch) -> None:
    upserts: list[tuple[str, str, str]] = []
    saved: list[dict[str, object]] = []

    monkeypatch.setattr(credentials, "_load_school_credentials_row", lambda user_id: None)
    monkeypatch.setattr(
        credentials,
        "load_user_content",
        lambda user_id, access_token: {
            "settings": {
                "school_account": "B11430207",
                "school_password": "legacy-password",
            }
        },
    )
    monkeypatch.setattr(credentials, "encrypt_school_password", lambda password: f"encrypted:{password}")
    monkeypatch.setattr(
        credentials,
        "_upsert_school_credentials_row",
        lambda user_id, username, password_ciphertext: upserts.append(
            (user_id, username, password_ciphertext)
        ),
    )
    monkeypatch.setattr(
        credentials,
        "save_user_content",
        lambda user_id, content, access_token: saved.append(content),
    )

    assert credentials.get_school_credentials_secret("user-1", "access-token") == {
        "username": "B11430207",
        "password": "legacy-password",
        "hasPassword": True,
    }
    assert upserts == [("user-1", "B11430207", "encrypted:legacy-password")]
    assert saved == [{"settings": {"school_account": "B11430207"}}]


def test_legacy_credential_migration_dry_run_counts_without_writing(monkeypatch) -> None:
    monkeypatch.setattr(
        legacy_credential_migration,
        "_fetch_user_data_rows",
        lambda: [
            {
                "user_id": "user-1",
                "content": {
                    "settings": {
                        "school_account": "B11430207",
                        "school_password": "legacy-password",
                    }
                },
            },
            {
                "user_id": "user-2",
                "content": {
                    "settings": {
                        "school_password": "legacy-password-without-username",
                    }
                },
            },
            {
                "user_id": "user-3",
                "content": {
                    "settings": {
                        "school_account": "B11430208",
                    }
                },
            },
        ],
    )
    monkeypatch.setattr(
        legacy_credential_migration,
        "_upsert_school_credentials_row",
        lambda *_args: pytest.fail("dry-run must not upsert credentials"),
    )
    monkeypatch.setattr(
        legacy_credential_migration,
        "_save_user_content",
        lambda *_args: pytest.fail("dry-run must not update user_data"),
    )

    assert legacy_credential_migration.migrate_legacy_school_credentials(apply=False) == {
        "scanned": 3,
        "eligible": 1,
        "migrated": 0,
        "skipped_missing_username": 1,
    }


def test_legacy_credential_migration_apply_encrypts_and_removes_plaintext(monkeypatch) -> None:
    source_content = {
        "settings": {
            "school_account": "B11430207",
            "school_password": "legacy-password",
        },
        "selectionPlan": {"courses": []},
    }
    upserts: list[tuple[str, str, str]] = []
    saved: list[tuple[str, dict[str, object]]] = []

    monkeypatch.setattr(
        legacy_credential_migration,
        "_fetch_user_data_rows",
        lambda: [{"user_id": "user-1", "content": source_content}],
    )
    monkeypatch.setattr(
        legacy_credential_migration.credentials,
        "encrypt_school_password",
        lambda password: f"encrypted:{password}",
    )
    monkeypatch.setattr(
        legacy_credential_migration,
        "_upsert_school_credentials_row",
        lambda user_id, username, password_ciphertext: upserts.append(
            (user_id, username, password_ciphertext)
        ),
    )
    monkeypatch.setattr(
        legacy_credential_migration,
        "_save_user_content",
        lambda user_id, content: saved.append((user_id, content)),
    )

    assert legacy_credential_migration.migrate_legacy_school_credentials(apply=True) == {
        "scanned": 1,
        "eligible": 1,
        "migrated": 1,
        "skipped_missing_username": 0,
    }
    assert upserts == [("user-1", "B11430207", "encrypted:legacy-password")]
    assert saved == [
        (
            "user-1",
            {
                "settings": {"school_account": "B11430207"},
                "selectionPlan": {"courses": []},
            },
        )
    ]


def test_legacy_credential_migration_handles_old_ciphertext_payload(monkeypatch) -> None:
    source_content = {
        "settings": {
            "schoolCredentials": {
                "username": "B11430207",
                "passwordCiphertext": "legacy-ciphertext",
            }
        }
    }
    upserts: list[tuple[str, str, str]] = []
    saved: list[dict[str, object]] = []

    monkeypatch.setattr(
        legacy_credential_migration,
        "_fetch_user_data_rows",
        lambda: [{"user_id": "user-1", "content": source_content}],
    )
    monkeypatch.setattr(
        legacy_credential_migration.credentials,
        "decrypt_school_password",
        lambda token: f"plain:{token}",
    )
    monkeypatch.setattr(
        legacy_credential_migration.credentials,
        "encrypt_school_password",
        lambda password: f"new:{password}",
    )
    monkeypatch.setattr(
        legacy_credential_migration,
        "_upsert_school_credentials_row",
        lambda user_id, username, password_ciphertext: upserts.append(
            (user_id, username, password_ciphertext)
        ),
    )
    monkeypatch.setattr(
        legacy_credential_migration,
        "_save_user_content",
        lambda _user_id, content: saved.append(content),
    )

    assert legacy_credential_migration.migrate_legacy_school_credentials(apply=True)["migrated"] == 1
    assert upserts == [("user-1", "B11430207", "new:plain:legacy-ciphertext")]
    assert saved == [{"settings": {"school_account": "B11430207"}}]


def test_school_credentials_status_does_not_return_password(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_current_user_context", lambda authorization: ("user-1", "token-1"))
    monkeypatch.setattr(
        backend_app,
        "get_school_credentials_status",
        lambda user_id, access_token: {
            "username": "B11430207",
            "hasPassword": True,
        },
    )
    client = TestClient(backend_app.app)

    response = client.get("/api/school-credentials", headers={"Authorization": "Bearer token-1"})

    assert response.status_code == 200
    assert response.json() == {"username": "B11430207", "hasPassword": True}
