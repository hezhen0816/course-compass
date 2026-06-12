from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from backend import app as backend_app
from backend import history, moodle, official_selection, planner_pdf, snapshots, tr_rooms
from backend.schedule import find_latest_course_list_url, group_schedule_entries


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
        {"priority": 1, "course_no": "FE1581701", "course_name": "休閒英文", "raw_priority": "1"}
    ]
    assert parsed["schedule_rows"] == [{"節次": "1", "星期一": "", "星期二": "休閒英文 TR-312"}]
    assert parsed["notices"] == ["請直接拖拉「登記志願清單」中的課程來變更志願序。"]


def test_tr_room_parsing_and_node_selection() -> None:
    meetings = tr_rooms.build_tr_meetings(
        [
            {
                "ClassRoomNo": "TR-213 / TR-514-1",
                "Node": "M1,M2",
                "CourseNo": "CS101",
                "CourseName": "演算法",
                "CourseTeacher": "林老師",
            }
        ]
    )
    moment = datetime(2026, 4, 13, 8, 30, tzinfo=ZoneInfo("Asia/Taipei"))

    assert [meeting.room for meeting in meetings] == ["TR-213", "TR-514-1"]
    assert tr_rooms.node_from_datetime(moment) == "M1"
    assert tr_rooms.next_node_from_datetime(moment) == "M2"
    assert tr_rooms.occupied_meetings(meetings, "M1")["TR-213"][0].course_name == "演算法"


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
              <tr><td>CC101A</td><td>英文字彙與閱讀(上)</td><td>1141</td><td>B+</td><td>2</td></tr>
              <tr><td>CC101B</td><td>英文字彙與閱讀(下)</td><td>1142</td><td>修習中</td><td>2</td></tr>
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
            "course_code": "CC101A",
            "course_name": "英文字彙與閱讀(上)",
            "academic_term": "1141",
            "grade": "B+",
            "earned_credits": "2",
            "ge_dimension": "",
        },
        {
            "category": "其他選修",
            "course_code": "CC101B",
            "course_name": "英文字彙與閱讀(下)",
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
                <td>1</td><td>1142</td><td>CC101B033</td><td>英文字彙與閱讀(下)</td><td>2</td>
                <td>成績未到</td><td>成績未到</td><td></td><td></td>
              </tr>
              <tr>
                <td>13</td><td>1141</td><td>CS1003301</td><td>計算機程式設計</td><td>3</td>
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
        "course_code": "CC101B033",
        "course_name": "英文字彙與閱讀(下)",
        "academic_term": "1142",
        "grade": "成績未到",
        "earned_credits": "2",
        "ge_dimension": "",
    }
    assert rows[1]["course_code"] == "CS1003301"
    assert rows[2]["category"] == "通識向度 B"
    assert rows[2]["ge_dimension"] == "B"


def test_supabase_load_snapshot_builds_encoded_query(monkeypatch) -> None:
    seen: dict[str, object] = {}
    monkeypatch.setattr(snapshots, "SUPABASE_URL", "https://example.supabase.co")
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

    assert snapshots.load_snapshot("abc/123") == {"ok": True}
    assert seen["url"] == (
        "https://example.supabase.co/rest/v1/schedule_sync_snapshots"
        "?profile_key=eq.abc%2F123&select=payload"
    )


def test_supabase_persist_snapshot_reuses_common_writer(monkeypatch) -> None:
    seen: dict[str, object] = {}
    monkeypatch.setattr(snapshots, "SUPABASE_URL", "https://example.supabase.co")
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
        profile_key="profile",
        school_account="student",
        payload={
            "imported_at": "2026-04-13T10:00:00+08:00",
            "student_name": "測試學生",
            "records": [],
        },
    )
    assert seen["url"] == "https://example.supabase.co/rest/v1/history_import_snapshots"
    assert seen["json"] == {
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


def test_requirement_pdf_parser_preserves_cs_choices() -> None:
    pdf_path = Path("/Users/hezhen/Downloads/114double 資工.pdf")
    if not pdf_path.exists():
        pytest.skip("local sample PDF is not available")

    parsed = planner_pdf.parse_requirement_pdf(pdf_path.read_bytes(), pdf_path.name)

    assert parsed["requirement_set"]["name"] == "114學年度資訊工程系雙主修應修科目表"
    assert parsed["requirement_set"]["total_credits"] == 47
    choices = {item["title"]: item for item in parsed["pending_requirements"] if item["kind"] == "choice"}
    assert choices["資訊工程導論或計算機概論"]["course_names"] == ["資訊工程導論", "計算機概論"]
    assert choices["程式語言或編譯器設計"]["course_names"] == ["程式語言", "編譯器設計"]
    assert any(item["title"] == "資料結構" for item in parsed["pending_requirements"])


def test_requirement_pdf_parser_preserves_business_credit_pool() -> None:
    pdf_path = Path("/Users/hezhen/Downloads/114double 企管.pdf")
    if not pdf_path.exists():
        pytest.skip("local sample PDF is not available")

    parsed = planner_pdf.parse_requirement_pdf(pdf_path.read_bytes(), pdf_path.name)

    assert parsed["requirement_set"]["name"] == "114學年度企業管理系雙主修應修科目表"
    assert parsed["requirement_set"]["total_credits"] == 43
    by_title = {item["title"]: item for item in parsed["pending_requirements"]}
    assert by_title["會計學／會計學(上)／初級會計學"]["course_names"] == ["會計學", "會計學(上)", "初級會計學"]
    assert by_title["BA 開頭專業課程"]["kind"] == "credit_pool"
    assert by_title["BA 開頭專業課程"]["required_credits"] == 18
    assert by_title["微積分"]["note"] == "基礎課程"


def test_course_search_endpoint_supports_name_and_code(monkeypatch) -> None:
    courses = [
        {
            "Semester": "1142",
            "CourseNo": "CS3005301",
            "CourseName": "物件導向程式設計",
            "CourseTeacher": "戴文凱",
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
            "CourseTeacher": "戴文凱",
            "CreditPoint": "1",
            "RequireOption": "R",
            "ClassRoomNo": "RB-509",
            "Node": "W6,W7,W8",
        },
    ]
    monkeypatch.setattr(
        backend_app,
        "fetch_query_courses_filtered",
        lambda semester, course_no, course_name, verify_ssl: courses,
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
            "CourseNo": "PE127A011",
            "CourseName": "體育(撞球)(上)",
            "CourseTeacher": "蔡尚明",
            "CreditPoint": "0",
            "RequireOption": "R",
            "ClassRoomNo": "",
            "Node": "M9,M10",
        },
        {
            "Semester": "1151",
            "CourseNo": "PE127A022",
            "CourseName": "體育(撞球)(上)",
            "CourseTeacher": "蔡尚明",
            "CreditPoint": "0",
            "RequireOption": "R",
            "ClassRoomNo": "",
            "Node": "T6,T7",
        },
        {
            "Semester": "1151",
            "CourseNo": "PE127B011",
            "CourseName": "體育(羽球)(上)",
            "CourseTeacher": "林教授",
            "CreditPoint": "0",
            "RequireOption": "R",
            "ClassRoomNo": "",
            "Node": "W1,W2",
        },
    ]
    monkeypatch.setattr(
        backend_app,
        "fetch_query_courses_filtered",
        lambda semester, course_no, course_name, verify_ssl: courses,
    )
    client = TestClient(backend_app.app)

    response = client.get("/api/courses/search", params={"semester": "1151", "q": "撞球", "mode": "name"})

    assert response.status_code == 200
    assert [item["course_no"] for item in response.json()] == ["PE127A011", "PE127A022"]


def test_course_search_endpoint_merges_same_course_code_nodes(monkeypatch) -> None:
    courses = [
        {
            "Semester": "1151",
            "CourseNo": "CS2002302",
            "CourseName": "資料結構",
            "CourseTeacher": "陳冠宇",
            "CreditPoint": "3",
            "RequireOption": "R",
            "ClassRoomNo": "",
            "Node": "M3,M4",
        },
        {
            "Semester": "1151",
            "CourseNo": "CS2002302",
            "CourseName": "資料結構",
            "CourseTeacher": "陳冠宇",
            "CreditPoint": "3",
            "RequireOption": "R",
            "ClassRoomNo": "",
            "Node": "W4",
        },
    ]
    monkeypatch.setattr(
        backend_app,
        "fetch_query_courses_filtered",
        lambda semester, course_no, course_name, verify_ssl: courses,
    )
    client = TestClient(backend_app.app)

    response = client.get("/api/courses/search", params={"semester": "1151", "q": "CS2002302", "mode": "code"})

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["course_no"] == "CS2002302"
    assert response.json()[0]["node"] == "M3, M4, W4"
