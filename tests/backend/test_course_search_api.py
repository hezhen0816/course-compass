from __future__ import annotations

from fastapi.testclient import TestClient

from backend import app as backend_app


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
            "CourseNo": "PE127A011",
            "CourseName": "體育(撞球)(上)",
            "CourseTeacher": "測試教師3",
            "CreditPoint": "0",
            "RequireOption": "R",
            "ClassRoomNo": "",
            "Node": "M9,M10",
        },
        {
            "Semester": "1151",
            "CourseNo": "PE127A022",
            "CourseName": "體育(撞球)(上)",
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

    response = client.get("/api/courses/search", params={"semester": "1151", "q": "撞球", "mode": "name"})

    assert response.status_code == 200
    assert [item["course_no"] for item in response.json()] == ["PE127A011", "PE127A022"]


def test_course_search_endpoint_merges_same_course_code_nodes(monkeypatch) -> None:
    courses = [
        {
            "Semester": "1151",
            "CourseNo": "CS2002302",
            "CourseName": "資料結構",
            "CourseTeacher": "測試教師4",
            "CreditPoint": "3",
            "RequireOption": "R",
            "ClassRoomNo": "",
            "Node": "M3,M4",
        },
        {
            "Semester": "1151",
            "CourseNo": "CS2002302",
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

    response = client.get("/api/courses/search", params={"semester": "1151", "q": "CS2002302", "mode": "code"})

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["course_no"] == "CS2002302"
    assert response.json()[0]["node"] == "M3, M4, W4"


def test_course_search_endpoint_passes_cross_school_flag(monkeypatch) -> None:
    seen: list[bool] = []

    def fake_fetch(semester, **kwargs):
        seen.append(kwargs["include_cross_school"])
        return []

    monkeypatch.setattr(backend_app, "fetch_query_courses_filtered", fake_fetch)
    client = TestClient(backend_app.app)

    assert client.get("/api/courses/search", params={"semester": "1151", "q": "經濟"}).status_code == 200
    assert client.get(
        "/api/courses/search",
        params={"semester": "1151", "q": "經濟", "include_cross_school": "true"},
    ).status_code == 200
    assert seen == [False, True]


def test_query_course_payload_toggles_ntust_only_flag() -> None:
    from backend.tr_rooms import query_course_payload

    assert query_course_payload("1151")["OnleyNTUST"] == 1
    assert query_course_payload("1151", include_cross_school=True)["OnleyNTUST"] == 0


def _friday_courses() -> list[dict]:
    return [
        {"Semester": "1151", "CourseNo": "BA2111303", "CourseName": "商業品牌故事力",
         "CourseTeacher": "測試教師5", "CreditPoint": "2", "RequireOption": "E",
         "ClassRoomNo": "TR-101", "Node": "F1,F2", "ChooseStudent": 22, "Restrict2": "50"},
        {"Semester": "1151", "CourseNo": "BA1914701", "CourseName": "理財實務",
         "CourseTeacher": "測試教師6", "CreditPoint": "3", "RequireOption": "E",
         "ClassRoomNo": "TR-102", "Node": "F2,F3,F4", "ChooseStudent": 35, "Restrict2": "50"},
        # 跨到週三：碰到 F1 但不是整段都在週五，不該出現在「週五 1-4 節」的結果裡
        {"Semester": "1151", "CourseNo": "CS9999301", "CourseName": "跨天的課",
         "CourseTeacher": "某師", "CreditPoint": "3", "RequireOption": "E",
         "ClassRoomNo": "TR-103", "Node": "W3,F1", "ChooseStudent": 10, "Restrict2": "50"},
        # 沒有節次（未排時間）
        {"Semester": "1151", "CourseNo": "CS8888301", "CourseName": "沒排時間的課",
         "CourseTeacher": "某師", "CreditPoint": "3", "RequireOption": "E",
         "ClassRoomNo": "", "Node": None, "ChooseStudent": 0, "Restrict2": "50"},
    ]


def test_search_by_node_only_needs_no_course_name(monkeypatch) -> None:
    """「週五 1-4 節有哪些課」本來就沒有課名可填。"""
    monkeypatch.setattr(backend_app, "fetch_query_courses", lambda semester, refresh, verify_ssl: _friday_courses())
    client = TestClient(backend_app.app)

    response = client.get("/api/courses/search", params={"semester": "1151", "node": "F1,F2,F3,F4"})

    assert response.status_code == 200
    assert [row["course_no"] for row in response.json()] == ["BA1914701", "BA2111303"]


def test_node_filter_excludes_courses_that_spill_outside_the_window(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "fetch_query_courses", lambda semester, refresh, verify_ssl: _friday_courses())
    client = TestClient(backend_app.app)

    codes = [row["course_no"] for row in client.get(
        "/api/courses/search", params={"semester": "1151", "node": "F1"}
    ).json()]

    assert "CS9999301" not in codes  # W3,F1 碰到 F1 但跨到週三
    assert "CS8888301" not in codes  # 沒有節次


def test_search_without_any_condition_is_refused(monkeypatch) -> None:
    """無條件整包撈是 2190 門、學校端 37 秒，不該讓它隨手發生。"""
    monkeypatch.setattr(backend_app, "fetch_query_courses", lambda semester, refresh, verify_ssl: _friday_courses())
    client = TestClient(backend_app.app)

    response = client.get("/api/courses/search", params={"semester": "1151"})

    assert response.status_code == 400
    assert "至少給一個條件" in response.json()["detail"]


def test_teacher_and_general_filters_are_passed_to_the_school(monkeypatch) -> None:
    seen: dict = {}

    def fake_fetch(semester, **kwargs):
        seen.update(kwargs)
        return []

    monkeypatch.setattr(backend_app, "fetch_query_courses_filtered", fake_fetch)
    client = TestClient(backend_app.app)

    client.get("/api/courses/search", params={
        "semester": "1151", "teacher": "測試教師7", "only_general": "true",
        "dimension": "e", "only_undergraduate": "true",
    })

    assert seen["teacher"] == "測試教師7"
    assert seen["only_general"] is True
    assert seen["dimension"] == "E"
    assert seen["only_undergraduate"] is True
