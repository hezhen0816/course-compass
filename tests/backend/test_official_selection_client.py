from __future__ import annotations

import pytest

from backend import official_selection


@pytest.fixture(autouse=True)
def offline_school_lookup(monkeypatch):
    monkeypatch.setattr(official_selection, "fetch_current_query_semester", lambda *args, **kwargs: "")
    monkeypatch.setattr(official_selection, "fetch_query_courses_filtered", lambda *args, **kwargs: [])


class FakeHTTPResponse:
    def __init__(self, text: str = "", url: str = "https://example.test/a02", status_code: int = 200) -> None:
        self.text = text
        self.url = url
        self.status_code = status_code

    def raise_for_status(self) -> None:
        return None


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
              <td>2</td><td>9:10～10:00</td><td></td><td>測試數位設計</td><td>測試數位設計</td>
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
                "course_name": "測試數位設計",
            },
            {
                "weekday_label": "星期四",
                "period": "7",
                "course_name": "測試數位設計",
            },
        ]
    )

    client = official_selection.OfficialSelectionClient()
    monkeypatch.setattr(client, "_fetch_course_list_schedule_rows", lambda verify_ssl: course_list_rows)

    payload = client._workspace_payload(FakeHTTPResponse(text=html), verify_ssl=False, refresh_choose_course_list=False)

    assert payload["schedule_rows"][1]["星期二"] == ""
    assert payload["schedule_rows"][1]["星期三"] == ""
    assert payload["schedule_rows"][5]["星期四"] == "測試數位設計"
    assert payload["schedule_rows"][6]["星期四"] == "測試數位設計"
    assert "官方功課表由正式課程清單校正。" in payload["notices"]


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


def test_official_selection_join_refreshes_workspace_before_and_after_post(monkeypatch) -> None:
    events: list[object] = []
    workspace_html = """
    <html>
      <head><title>初選登記選課</title></head>
      <body>
        <table id="cartTable">
          <tr><td>志願序</td><td>課碼</td><td>課程名稱</td><td>取消加入</td></tr>
          <tr><td>1</td><td>ZZ2002302</td><td>資料結構</td><td>取消加入</td></tr>
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

    payload = client.join_course(" zz2002302 ", verify_ssl=False)

    assert events == [
        ("get_workspace", False),
        (
            "post",
            official_selection.INITIAL_SELECTION_JOIN_URL,
            {"CourseNo": "ZZ2002302", "type": 1},
        ),
        ("get_workspace", False),
    ]
    assert payload["session_valid"] is True
    assert payload["registered_courses"][0]["course_no"] == "ZZ2002302"


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

    client.add_course_to_waitlist(" zz2208302 ", verify_ssl=False)

    assert events == [
        ("get_workspace", False),
        (
            "post",
            official_selection.INITIAL_SELECTION_EXTRA_JOIN_URL,
            {"CourseNo": "ZZ2208302", "type": 3},
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
            <div class="table-cell">ZZ125A021</div>
            <div class="table-cell">測試體能(上)</div>
            <div class="table-cell">測試教師11</div>
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

    payload = client.join_course("zz125a021", verify_ssl=False)

    assert events == [
        ("get_workspace", False),
        (
            "post",
            official_selection.INITIAL_SELECTION_JOIN_URL,
            {"CourseNo": "ZZ125A021", "type": 1},
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
            <div class="table-cell">ZZ2208302</div>
            <div class="table-cell">測試會計</div>
            <div class="table-cell">測試教師12</div>
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

    payload = client.join_course("zz2208302", verify_ssl=False)

    assert events == [
        ("get_workspace", False),
        (
            "post",
            official_selection.INITIAL_SELECTION_JOIN_URL,
            {"CourseNo": "ZZ2208302", "type": 1},
        ),
        ("get_workspace", False),
    ]
    assert payload["notices"][0] == "本門課設有選課班級條件，您不符合條件，無法選修。"


def test_official_selection_join_silent_rejection_has_no_action_notice(monkeypatch) -> None:
    # The school accepted the POST but said nothing and did not add the course.
    # The workspace page's announcement must not be reported as the reason.
    workspace_html = """
    <html>
      <body>
        <div class="alert">公告訊息 ※ 115 學年度第 1 學期選課作業時程表 ※ 本校嚴禁使用限制第三方程式搶課</div>
        <div id="draggable">
          <div class="table-row">
            <div class="table-cell">課碼</div>
            <div class="table-cell">課程名稱</div>
            <div class="table-cell">上課教師</div>
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
            return FakeHTTPResponse(text="", url=endpoint)

    client = official_selection.OfficialSelectionClient()
    client.session = FakeSession()  # type: ignore[assignment]
    monkeypatch.setattr(client, "_get_workspace_page", lambda verify_ssl: FakeHTTPResponse(text=workspace_html))
    monkeypatch.setattr(client, "_fetch_course_list_schedule_rows", lambda verify_ssl: [])

    payload = client.join_course("zz125a021", verify_ssl=False)

    assert payload["action_notices"] == []
    assert any("公告訊息" in text for text in payload["notices"])


def test_official_selection_add_drop_uses_b01_endpoint_and_reads_its_alert(monkeypatch) -> None:
    events: list[object] = []
    b01_html = """
    <html><body>
      <script>alert("這門課遴選不開放選修，所以無法選修。");</script>
      <table id="cartTable"></table>
    </body></html>
    """
    workspace_html = "<html><body><div id='draggable'></div></body></html>"

    class FakeSession:
        def __init__(self) -> None:
            self.headers: dict[str, str] = {}

        def get(self, url: str, **kwargs: object) -> FakeHTTPResponse:
            events.append(("get", url))
            return FakeHTTPResponse(text=b01_html, url=url)

        def post(self, endpoint: str, **kwargs: object) -> FakeHTTPResponse:
            events.append(("post", endpoint, kwargs["data"], kwargs["headers"]["Referer"]))
            return FakeHTTPResponse(text="", url=endpoint)

    client = official_selection.OfficialSelectionClient()
    client.session = FakeSession()  # type: ignore[assignment]
    monkeypatch.setattr(client, "_get_workspace_page", lambda verify_ssl: FakeHTTPResponse(text=workspace_html))
    monkeypatch.setattr(client, "_refresh_choose_course_list", lambda verify_ssl: (None, []))
    monkeypatch.setattr(client, "_fetch_course_list_schedule_rows", lambda verify_ssl: [])

    payload = client.add_course_to_waitlist("zz4711302", verify_ssl=False, period="B01")

    assert events[0] == ("get", official_selection.ADD_DROP_URL)
    assert events[1] == (
        "post",
        official_selection.ADD_DROP_EXTRA_JOIN_URL,
        {"CourseNo": "ZZ4711302", "type": 3},
        official_selection.ADD_DROP_URL,
    )
    assert payload["action_notices"] == ["這門課遴選不開放選修，所以無法選修。"]
