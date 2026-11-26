from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
import requests
from fastapi.testclient import TestClient

from backend import app as backend_app
from backend.api import tr_rooms as tr_rooms_api
from backend import credentials
from backend.gpa import GpaResult
from backend import history, moodle, official_selection, planner_pdf, snapshots, tr_rooms
from backend.schedule import find_latest_course_list_url, group_schedule_entries


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
            "professor": "測試教師8",
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
            "instructor": "測試教師8",
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
    assert "school_credentials" not in payload["capabilities"]
    assert "/api/school-credentials" not in client.get("/openapi.json").json()["paths"]
    assert "school_sessions" not in payload["capabilities"]
    assert payload["capabilities"]["official_selection"] is True
    assert set(payload["capabilities"]["official_selection_actions"]) == {
        "sync",
        "keep_alive",
        "join",
        "add_to_waitlist",
        "remove",
        "reorder",
    }


def test_healthz_reports_ready() -> None:
    client = TestClient(backend_app.app)

    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


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
            <div class="table-cell">ZZ100A022</div>
            <div class="table-cell">測試運動(上)</div>
            <div class="table-cell">測試教師3</div>
            <div class="table-cell"><span class="addbtn btn">加入登記</span></div>
          </div>
        </div>
        <table id="cartTable">
          <tr><td>志願序</td><td>課碼</td><td>課程名稱</td><td>取消加入</td></tr>
          <tr><td>1</td><td>FE1581701</td><td>測試語言</td><td>取消加入</td></tr>
        </table>
        <div id="loginModal">
          <table>
            <tr><th>節次</th><th>星期一</th><th>星期二</th></tr>
            <tr><td>1</td><td></td><td>測試語言<br>TR-312</td></tr>
          </table>
        </div>
      </body>
    </html>
    """

    parsed = official_selection.parse_a02_workspace(html)

    assert parsed["page_title"] == "初選登記選課"
    assert parsed["available_courses"] == [
        {"course_no": "ZZ100A022", "course_name": "測試運動(上)", "teacher": "測試教師3"}
    ]
    assert parsed["registered_courses"] == [
        {
            "priority": 1,
            "course_no": "FE1581701",
            "course_name": "測試語言",
            "raw_priority": "1",
            "credits": None,
            "require_option": "",
            "teacher": "",
        }
    ]
    assert parsed["schedule_rows"] == [{"節次": "1", "星期一": "", "星期二": "測試語言 TR-312"}]
    assert parsed["notices"] == ["請直接拖拉「登記志願清單」中的課程來變更志願序。"]


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
              <td>6</td><td>13:20～14:10</td><td></td><td>測試運動(上)（1）</td><td></td>
              <td>測試數位設計</td><td></td><td></td><td></td>
            </tr>
            <tr>
              <td>7</td><td>14:20～15:10</td><td></td><td>測試運動(上)（1）</td><td></td>
              <td>測試數位設計</td><td></td><td></td><td></td>
            </tr>
          </table>
        </div>
      </body>
    </html>
    """

    parsed = official_selection.parse_a02_workspace(html)

    assert parsed["schedule_rows"][0]["時間"] == "13:20～14:10"
    assert parsed["schedule_rows"][0]["星期二"] == "測試運動(上)（1）"
    assert parsed["schedule_rows"][0]["星期四"] == "測試數位設計"
    assert parsed["schedule_rows"][1]["星期二"] == "測試運動(上)（1）"


def test_official_selection_schedule_rows_from_synced_slots() -> None:
    rows = official_selection._schedule_rows_from_slots(
        [
            {
                "weekday_label": "星期二",
                "period": "6",
                "course_name": "測試運動(上)",
            },
            {
                "weekday_label": "星期二",
                "period": "7",
                "course_name": "測試運動(上)",
            },
            {
                "weekday_label": "星期四",
                "period": "6",
                "course_name": "測試數位設計",
            },
        ]
    )

    assert rows[5]["節次"] == "6"
    assert rows[5]["星期二"] == "測試運動(上)"
    assert rows[5]["星期四"] == "測試數位設計"
    assert rows[6]["星期二"] == "測試運動(上)"


def test_official_selection_arraydata_form_rows_matches_saveidx_shape() -> None:
    rows = official_selection._arraydata_form_rows(
        [
            ["志願序", "課碼", "課程名稱", "取消加入"],
            ["1", "ZZ100A022", "測試運動(上)", "取消加入"],
        ]
    )

    assert rows == [
        ("Arraydata[0][0]", "志願序"),
        ("Arraydata[0][1]", "課碼"),
        ("Arraydata[0][2]", "課程名稱"),
        ("Arraydata[0][3]", "取消加入"),
        ("Arraydata[1][0]", "1"),
        ("Arraydata[1][1]", "ZZ100A022"),
        ("Arraydata[1][2]", "測試運動(上)"),
        ("Arraydata[1][3]", "取消加入"),
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
            "username": "B00000001",
            "course_no": "ZZ2002302",
            "profile_key": "B00000001",
            "verify_ssl": False,
        },
    )

    assert response.status_code == 400
    assert "明確確認" in response.json()["detail"]
    assert client_called is False


def test_schedule_sync_uses_request_password(monkeypatch) -> None:
    calls: list[tuple[str, str, bool]] = []

    monkeypatch.setattr(backend_app, "_authorization_context", lambda authorization: ("user-1", "token-1"))

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
            "username": "B00000001",
            "password": "test-password",
            "profile_key": "B00000001",
            "persist_to_supabase": False,
            "verify_ssl": False,
        },
    )

    assert response.status_code == 200
    assert response.json()["school_account"] == "B00000001"
    assert calls == [("B00000001", "test-password", True)]


def test_schedule_sync_requires_request_password(monkeypatch) -> None:
    fetch_called = False

    def fake_fetch_schedule(username: str, password: str, verify_ssl: bool) -> dict[str, object]:
        nonlocal fetch_called
        fetch_called = True
        raise AssertionError("schedule fetch should not run without a password")

    monkeypatch.setattr(backend_app, "fetch_schedule", fake_fetch_schedule)
    monkeypatch.setattr(backend_app, "_authorization_context", lambda authorization: ("user-1", "token-1"))
    client = TestClient(backend_app.app)

    response = client.post(
        "/api/schedule/sync",
        headers={"Authorization": "Bearer token-1"},
        json={
            "username": "B00000001",
            "profile_key": "B00000001",
            "persist_to_supabase": False,
            "verify_ssl": False,
        },
    )

    assert response.status_code == 400
    assert "校務密碼" in response.json()["detail"]
    assert fetch_called is False


def test_schedule_sync_rejects_unauthenticated_requests(monkeypatch) -> None:
    fetch_called = False

    def fake_fetch_schedule(username: str, password: str, verify_ssl: bool) -> dict[str, object]:
        nonlocal fetch_called
        fetch_called = True
        raise AssertionError("schedule fetch must not run without a cloud session")

    monkeypatch.setattr(backend_app, "fetch_schedule", fake_fetch_schedule)
    client = TestClient(backend_app.app)

    response = client.post(
        "/api/schedule/sync",
        json={
            "username": "B00000001",
            "password": "school-password",
            "persist_to_supabase": True,
            "verify_ssl": False,
        },
    )

    assert response.status_code == 401
    assert fetch_called is False


def test_snapshot_reads_are_scoped_to_the_cloud_user(monkeypatch) -> None:
    snapshot = {
        "profile_key": "B00000001",
        "school_account": "B00000001",
        "source_url": "https://example.test/schedule",
        "page_title": "選課清單",
        "total_credits_text": "0",
        "total_credits": 0,
        "courses": [],
        "slots": [],
        "schedule_entries": [],
        "student_name": None,
        "synced_at": "2026-09-06T20:00:00+08:00",
        "course_count": 0,
        "scheduled_slot_count": 0,
        "schedule_entry_count": 0,
        "persisted_to_supabase": True,
    }
    stored = {("user-1", "B00000001"): snapshot}
    monkeypatch.setattr(backend_app, "load_snapshot", lambda user_id, profile_key: stored.get((user_id, profile_key)))
    monkeypatch.setattr(backend_app, "load_moodle_assignments_snapshot", lambda user_id, profile_key: None)
    monkeypatch.setattr(backend_app, "load_history_snapshot", lambda user_id, profile_key: None)
    client = TestClient(backend_app.app)

    # No cloud session at all.
    assert client.get("/api/schedule/B00000001").status_code == 401

    monkeypatch.setattr(backend_app, "_authorization_context", lambda authorization: ("user-1", "token-1"))
    headers = {"Authorization": "Bearer token-1"}

    # Another student's profile.
    assert client.get("/api/schedule/B99999999", headers=headers).status_code == 404
    assert client.get("/api/moodle/assignments/B99999999", headers=headers).status_code == 404
    assert client.get("/api/history/B99999999", headers=headers).status_code == 404

    # Own profile.
    response = client.get("/api/schedule/B00000001", headers=headers)
    assert response.status_code == 200
    assert response.json()["school_account"] == "B00000001"

    # A different signed-in user cannot read the first user’s snapshot.
    monkeypatch.setattr(backend_app, "_authorization_context", lambda authorization: ("user-2", "token-2"))
    assert client.get("/api/schedule/B00000001", headers=headers).status_code == 404


def test_official_selection_requires_cloud_session_and_scopes_client_to_user(monkeypatch) -> None:
    created_keys: list[str] = []

    class FakeOfficialSelectionClient:
        def keep_alive(self, verify_ssl: bool) -> bool:
            return True

        def export_session_state(self) -> dict[str, object]:
            return {}

        def fetch_current_a02_workspace(self, verify_ssl: bool) -> dict[str, object]:
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

    def fake_get_client(profile_key: str) -> FakeOfficialSelectionClient:
        created_keys.append(profile_key)
        return FakeOfficialSelectionClient()

    monkeypatch.setattr(backend_app, "get_official_selection_client", fake_get_client)
    client = TestClient(backend_app.app)
    body = {"username": "B00000001", "profile_key": "B00000001", "verify_ssl": False}

    # Without a cloud session the cached school session must not even be touched.
    assert client.post("/api/official-selection/a02/sync", json=body).status_code == 401
    assert created_keys == []

    monkeypatch.setattr(backend_app, "_authorization_context", lambda authorization: ("user-1", "token-1"))
    headers = {"Authorization": "Bearer token-1"}

    response = client.post("/api/official-selection/a02/sync", headers=headers, json=body)
    assert response.status_code == 200
    assert created_keys == ["user-1:B00000001"]

    monkeypatch.setattr(backend_app, "_authorization_context", lambda authorization: ("user-2", "token-2"))
    assert client.post("/api/official-selection/a02/sync", headers=headers, json=body).status_code == 200
    assert created_keys == ["user-1:B00000001", "user-2:B00000001"]


def test_history_import_uses_request_password(monkeypatch) -> None:
    calls: list[tuple[str, str, bool]] = []

    monkeypatch.setattr(backend_app, "_authorization_context", lambda authorization: ("user-1", "token-1"))

    def fake_fetch_history_records(username: str, password: str, verify_ssl: bool) -> dict[str, object]:
        calls.append((username, password, verify_ssl))
        return {
            "source_url": "https://example.test/history",
            "page_title": "歷年成績",
            "student_name": "測試學生",
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
            "username": "B00000001",
            "password": "test-password",
            "profile_key": "B00000001",
            "persist_to_supabase": False,
            "verify_ssl": False,
        },
    )

    assert response.status_code == 200
    assert response.json()["student_no"] == "B00000001"
    assert calls == [("B00000001", "test-password", True)]


def test_moodle_sync_uses_request_password(monkeypatch) -> None:
    calls: list[tuple[str, str, bool]] = []

    monkeypatch.setattr(backend_app, "_authorization_context", lambda authorization: ("user-1", "token-1"))

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
            "username": "B00000001",
            "password": "test-password",
            "profile_key": "B00000001",
            "persist_to_supabase": False,
            "verify_ssl": False,
        },
    )

    assert response.status_code == 200
    assert response.json()["timeline_filter"] == "未來"
    assert calls == [("B00000001", "test-password", True)]


def test_resolve_user_id_validates_token_with_supabase_auth(monkeypatch) -> None:
    calls: list[tuple[str, dict[str, str]]] = []

    def fake_get(url: str, headers: dict[str, str], timeout: int) -> FakeAuthResponse:
        calls.append((url, headers))
        return FakeAuthResponse({"id": "user-1"})

    monkeypatch.setattr(credentials, "SUPABASE_URL", "https://database.example.org")
    monkeypatch.setattr(credentials, "SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setattr(credentials, "SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    monkeypatch.setattr(credentials.requests, "get", fake_get)

    assert credentials.resolve_user_id("access-token") == "user-1"
    assert calls == [
        (
            "https://database.example.org/auth/v1/user",
            {
                "apikey": "anon-key",
                "Authorization": "Bearer access-token",
                "Accept": "application/json",
            },
        )
    ]


def test_resolve_user_id_rejects_invalid_supabase_auth_token(monkeypatch) -> None:
    monkeypatch.setattr(credentials, "SUPABASE_URL", "https://database.example.org")
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

    monkeypatch.setattr(credentials, "SUPABASE_URL", "https://database.example.org")
    monkeypatch.setattr(credentials, "SUPABASE_ANON_KEY", "your-anon-key")
    monkeypatch.setattr(credentials, "SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    monkeypatch.setattr(credentials.requests, "get", fake_get)

    assert credentials.resolve_user_id("access-token") == "user-1"
    assert captured_headers[0]["apikey"] == "service-role-key"
    assert captured_headers[0]["Authorization"] == "Bearer access-token"


def test_tr_room_parsing_and_node_selection() -> None:
    meetings = tr_rooms.build_tr_meetings(
        [
            {
                "ClassRoomNo": "TR-213 / TR-514-1",
                "Node": "M1,M2",
                "CourseNo": "CS101",
                "CourseName": "演算法",
                "CourseTeacher": "測試教師9",
            }
        ]
    )
    moment = datetime(2026, 4, 13, 8, 30, tzinfo=ZoneInfo("Asia/Taipei"))

    assert [meeting.room for meeting in meetings] == ["TR-213", "TR-514-1"]
    assert tr_rooms.node_from_datetime(moment) == "M1"
    assert tr_rooms.next_node_from_datetime(moment) == "M2"
    assert tr_rooms.occupied_meetings(meetings, "M1")["TR-213"][0].course_name == "演算法"


def test_tr_room_status_endpoint_reports_room_availability(monkeypatch) -> None:
    monkeypatch.setattr(tr_rooms_api, "now", lambda: datetime(2026, 4, 13, 8, 30, tzinfo=ZoneInfo("Asia/Taipei")))
    monkeypatch.setattr(tr_rooms_api, "fetch_current_query_semester", lambda verify_ssl: "1151")
    monkeypatch.setattr(
        tr_rooms_api,
        "fetch_query_courses",
        lambda semester, refresh, verify_ssl: [
            {
                "ClassRoomNo": "TR-213",
                "Node": "M1",
                "CourseNo": "CS101",
                "CourseName": "演算法",
                "CourseTeacher": "測試教師9",
            }
        ],
    )
    client = TestClient(backend_app.app)

    response = client.get("/api/tr-rooms/status", params={"room": "tr-213", "node": "M1"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["semester"] == "1151"
    assert payload["room"] == "TR-213"
    assert payload["room_is_free"] is False
    assert payload["room_meetings"][0]["course_name"] == "演算法"


def test_moodle_assignment_filter_keeps_actionable_items_and_sorts() -> None:
    items = [
        {
            "due_at": "2026-04-15T10:00:00+08:00",
            "title": "閱讀公告",
            "course_name": "A",
            "action_label": "",
            "action_url": "",
            "event_url": "/mod/forum/view.php",
            "module_name": "forum",
            "event_type": "due",
        },
        {
            "due_at": "2026-04-14T10:00:00+08:00",
            "title": "小考",
            "course_name": "B",
            "action_label": "",
            "action_url": "/mod/quiz/view.php",
            "event_url": "",
            "module_name": "quiz",
            "event_type": "due",
        },
        {
            "due_at": "2026-04-13T10:00:00+08:00",
            "title": "作業一",
            "course_name": "A",
            "action_label": "繳交作業",
            "action_url": "/mod/assign/view.php",
            "event_url": "",
            "module_name": "assign",
            "event_type": "due",
        },
    ]

    filtered = moodle.filter_moodle_assignment_items(items)

    assert [item["title"] for item in filtered] == ["作業一", "小考"]


def test_history_parser_reads_edu_need_course_table() -> None:
    soup = history.BeautifulSoup(
        """
        <table>
          <tr><td class="TD_title1_C">其他選修</td></tr>
          <tr><td>
            <table>
              <tr><td>課程代碼</td><td>課程名稱</td><td>學年期</td><td>成績</td><td>實得學分</td></tr>
              <tr><td>ZZ101A</td><td>測試閱讀(上)</td><td>1141</td><td>B+</td><td>2</td></tr>
              <tr><td>ZZ101B</td><td>測試閱讀(下)</td><td>1142</td><td>修習中</td><td>2</td></tr>
            </table>
          </td></tr>
        </table>
        """,
        "html.parser",
    )

    rows = history.extract_history_course_tables(soup)

    assert rows == [
        {
            "category": "其他選修",
            "course_code": "ZZ101A",
            "course_name": "測試閱讀(上)",
            "academic_term": "1141",
            "grade": "B+",
            "earned_credits": "2",
            "ge_dimension": "",
        },
        {
            "category": "其他選修",
            "course_code": "ZZ101B",
            "course_name": "測試閱讀(下)",
            "academic_term": "1142",
            "grade": "修習中",
            "earned_credits": "2",
            "ge_dimension": "",
        },
    ]


def test_history_parser_reads_score_display_all_course_table() -> None:
    soup = history.BeautifulSoup(
        """
        <div class="box">
          <div class="box-header"><h2>歷年學業成績列表</h2></div>
          <div class="box-content">
            <table>
              <tr>
                <th>序</th><th>學年期</th><th>課程代碼</th><th>課程名稱</th><th>學分數</th>
                <th>成績</th><th>備註說明</th><th>通識向度</th><th>遠距教學課程</th>
              </tr>
              <tr>
                <td>1</td><td>1142</td><td>ZZ101B033</td><td>測試閱讀(下)</td><td>2</td>
                <td>成績未到</td><td>成績未到</td><td></td><td></td>
              </tr>
              <tr>
                <td>13</td><td>1141</td><td>ZZ1003301</td><td>計算機程式設計</td><td>3</td>
                <td>B</td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td>14</td><td>1142</td><td>GE3731301</td><td>科技與法律</td><td>2</td>
                <td>成績未到</td><td>成績未到</td><td>B</td><td></td>
              </tr>
            </table>
          </div>
        </div>
        """,
        "html.parser",
    )

    rows = history.extract_history_course_tables(soup)

    assert rows[0] == {
        "category": "歷年學業成績",
        "course_code": "ZZ101B033",
        "course_name": "測試閱讀(下)",
        "academic_term": "1142",
        "grade": "成績未到",
        "earned_credits": "2",
        "ge_dimension": "",
    }
    assert rows[1]["course_code"] == "ZZ1003301"
    assert rows[2]["category"] == "通識向度 B"
    assert rows[2]["ge_dimension"] == "B"


def test_supabase_load_snapshot_builds_encoded_query(monkeypatch) -> None:
    seen: dict[str, object] = {}
    monkeypatch.setattr(snapshots, "SUPABASE_URL", "https://database.example.org")
    monkeypatch.setattr(snapshots, "SUPABASE_SERVICE_ROLE_KEY", "service-key")

    class Response:
        status_code = 200
        text = "ok"

        @staticmethod
        def json() -> list[dict[str, object]]:
            return [{"payload": {"ok": True}}]

    def fake_get(url: str, **kwargs: object) -> Response:
        seen["url"] = url
        seen["headers"] = kwargs["headers"]
        return Response()

    monkeypatch.setattr(snapshots.requests, "get", fake_get)

    assert snapshots.load_snapshot("user-1", "abc/123") == {"ok": True}
    assert seen["url"] == (
        "https://database.example.org/rest/v1/schedule_sync_snapshots"
        "?user_id=eq.user-1&profile_key=eq.abc%2F123&select=payload"
    )


def test_supabase_persist_snapshot_reuses_common_writer(monkeypatch) -> None:
    seen: dict[str, object] = {}
    monkeypatch.setattr(snapshots, "SUPABASE_URL", "https://database.example.org")
    monkeypatch.setattr(snapshots, "SUPABASE_SERVICE_ROLE_KEY", "service-key")

    class Response:
        status_code = 201
        text = "created"

    def fake_post(url: str, **kwargs: object) -> Response:
        seen["url"] = url
        seen["json"] = kwargs["json"]
        seen["headers"] = kwargs["headers"]
        return Response()

    monkeypatch.setattr(snapshots.requests, "post", fake_post)

    assert snapshots.persist_history_snapshot(
        user_id="user-1",
        profile_key="profile",
        school_account="student",
        payload={
            "imported_at": "2026-04-13T10:00:00+08:00",
            "student_name": "測試學生",
            "records": [],
        },
    )
    assert seen["url"] == "https://database.example.org/rest/v1/history_import_snapshots"
    assert seen["json"] == {
        "user_id": "user-1",
        "profile_key": "profile",
        "school_account": "student",
        "payload": {
            "imported_at": "2026-04-13T10:00:00+08:00",
            "student_name": "測試學生",
            "records": [],
        },
        "imported_at": "2026-04-13T10:00:00+08:00",
        "student_name": "測試學生",
    }


def test_course_search_endpoint_supports_name_and_code(monkeypatch) -> None:
    courses = [
        {
            "Semester": "1142",
            "CourseNo": "CS3005301",
            "CourseName": "物件導向程式設計",
            "CourseTeacher": "測試教師2",
            "CreditPoint": "3",
            "RequireOption": "R",
            "ClassRoomNo": "TR-311",
            "Node": "T6,T7,T8",
            "Contents": "學號單數",
            "ChooseStudent": 43,
            "Restrict2": "55",
        },
        {
            "Semester": "1142",
            "CourseNo": "CS1010301",
            "CourseName": "物件導向程式設計實習",
            "CourseTeacher": "測試教師2",
            "CreditPoint": "1",
            "RequireOption": "R",
            "ClassRoomNo": "RB-509",
            "Node": "W6,W7,W8",
        },
    ]
    monkeypatch.setattr(
        backend_app,
        "fetch_query_courses_filtered",
        lambda semester, **kwargs: courses,
    )
    client = TestClient(backend_app.app)

    by_name = client.get("/api/courses/search", params={"semester": "1142", "q": "物件導向程式設計", "mode": "name"})
    by_code = client.get("/api/courses/search", params={"semester": "1142", "q": "CS3005301", "mode": "code"})

    assert by_name.status_code == 200
    assert [item["course_no"] for item in by_name.json()] == ["CS3005301", "CS1010301"]
    assert by_code.status_code == 200
    assert by_code.json()[0]["node"] == "T6,T7,T8"


def test_course_search_endpoint_supports_partial_course_name(monkeypatch) -> None:
    courses = [
        {
            "Semester": "1151",
            "CourseNo": "ZZ100A011",
            "CourseName": "測試運動(上)",
            "CourseTeacher": "測試教師3",
            "CreditPoint": "0",
            "RequireOption": "R",
            "ClassRoomNo": "",
            "Node": "M9,M10",
        },
        {
            "Semester": "1151",
            "CourseNo": "ZZ100A022",
            "CourseName": "測試運動(上)",
            "CourseTeacher": "測試教師3",
            "CreditPoint": "0",
            "RequireOption": "R",
            "ClassRoomNo": "",
            "Node": "T6,T7",
        },
        {
            "Semester": "1151",
            "CourseNo": "PE127B011",
            "CourseName": "體育(羽球)(上)",
            "CourseTeacher": "測試教師10",
            "CreditPoint": "0",
            "RequireOption": "R",
            "ClassRoomNo": "",
            "Node": "W1,W2",
        },
    ]
    monkeypatch.setattr(
        backend_app,
        "fetch_query_courses_filtered",
        lambda semester, **kwargs: courses,
    )
    client = TestClient(backend_app.app)

    response = client.get("/api/courses/search", params={"semester": "1151", "q": "測試運動", "mode": "name"})

    assert response.status_code == 200
    assert [item["course_no"] for item in response.json()] == ["ZZ100A011", "ZZ100A022"]


def test_course_search_endpoint_merges_same_course_code_nodes(monkeypatch) -> None:
    courses = [
        {
            "Semester": "1151",
            "CourseNo": "ZZ2002302",
            "CourseName": "資料結構",
            "CourseTeacher": "測試教師4",
            "CreditPoint": "3",
            "RequireOption": "R",
            "ClassRoomNo": "",
            "Node": "M3,M4",
        },
        {
            "Semester": "1151",
            "CourseNo": "ZZ2002302",
            "CourseName": "資料結構",
            "CourseTeacher": "測試教師4",
            "CreditPoint": "3",
            "RequireOption": "R",
            "ClassRoomNo": "",
            "Node": "W4",
        },
    ]
    monkeypatch.setattr(
        backend_app,
        "fetch_query_courses_filtered",
        lambda semester, **kwargs: courses,
    )
    client = TestClient(backend_app.app)

    response = client.get("/api/courses/search", params={"semester": "1151", "q": "ZZ2002302", "mode": "code"})

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["course_no"] == "ZZ2002302"
    assert response.json()[0]["node"] == "M3, M4, W4"


def test_schedule_sync_attaches_gpa_when_key_present(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_authorization_context", lambda authorization: ("user-1", "token-1"))
    monkeypatch.setattr(backend_app, "get_gpa_api_key_secret", lambda user_id: "key-1")
    monkeypatch.setattr(
        backend_app,
        "fetch_section_gpas",
        lambda sections, api_key, verify_ssl: {
            "ZZ2002302": GpaResult(3.31, "found", 1141, 52, "測試教師4", "ZZ2002302"),
            "ZZ125A032": GpaResult(None, "no_data"),
        },
    )
    monkeypatch.setattr(
        backend_app,
        "fetch_schedule",
        lambda username, password, verify_ssl: {
            "source_url": "https://example.test/schedule",
            "page_title": "選課清單",
            "total_credits_text": "0",
            "total_credits": 0,
            "courses": [
                {"course_code": "ZZ2002302", "course_name": "資料結構", "credits": 3, "required_type": "R", "professor": "測試教師4", "note": ""},
                {"course_code": "ZZ125A032", "course_name": "體育", "credits": 0, "required_type": "R", "professor": "", "note": ""},
            ],
            "slots": [],
            "schedule_entries": [],
        },
    )
    client = TestClient(backend_app.app)
    response = client.post(
        "/api/schedule/sync",
        headers={"Authorization": "Bearer token-1"},
        json={"username": "B00000001", "password": "test-password", "profile_key": "B00000001", "persist_to_supabase": False, "verify_ssl": False},
    )
    assert response.status_code == 200
    courses = {row["course_code"]: row for row in response.json()["courses"]}
    assert courses["ZZ2002302"]["gpa"] == 3.31 and courses["ZZ2002302"]["gpa_status"] == "found"
    assert courses["ZZ2002302"]["gpa_semester"] == 1141 and courses["ZZ2002302"]["gpa_teacher"] == "測試教師4"
    assert courses["ZZ125A032"]["gpa"] is None and courses["ZZ125A032"]["gpa_status"] == "no_data"


def test_schedule_sync_survives_gpa_lookup_failure(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_authorization_context", lambda authorization: ("user-1", "token-1"))
    monkeypatch.setattr(backend_app, "get_gpa_api_key_secret", lambda user_id: "key-1")

    def boom(course_nos, api_key, verify_ssl):
        raise RuntimeError("myNTUST down")

    monkeypatch.setattr(backend_app, "fetch_section_gpas", boom)
    monkeypatch.setattr(
        backend_app,
        "fetch_schedule",
        lambda username, password, verify_ssl: {
            "source_url": "https://example.test/schedule",
            "page_title": "選課清單",
            "total_credits_text": "0",
            "total_credits": 0,
            "courses": [{"course_code": "ZZ2002302", "course_name": "資料結構", "credits": 3, "required_type": "R", "professor": "", "note": ""}],
            "slots": [],
            "schedule_entries": [],
        },
    )
    client = TestClient(backend_app.app)
    response = client.post(
        "/api/schedule/sync",
        headers={"Authorization": "Bearer token-1"},
        json={"username": "B00000001", "password": "test-password", "profile_key": "B00000001", "persist_to_supabase": False, "verify_ssl": False},
    )
    assert response.status_code == 200
    assert response.json()["courses"][0]["gpa"] is None
