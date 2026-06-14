from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from backend import app as backend_app
from backend.api import tr_rooms as tr_rooms_api
from backend.integrations import tr_rooms


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
                "CourseTeacher": "林老師",
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
