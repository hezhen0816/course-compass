from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import tr_rooms as tr_rooms_api
from backend.tr_rooms import normalize_room_code

COURSES = [
    {"CourseNo": "C1", "CourseName": "Course", "CourseTeacher": "T", "ClassRoomNo": "TR-613", "Node": "M1"},
    {"CourseNo": "C2", "CourseName": "Other", "CourseTeacher": "T", "ClassRoomNo": "TR-407-1", "Node": "M2"},
]


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(tr_rooms_api, "fetch_current_query_semester", lambda verify_ssl=True: "1142")
    monkeypatch.setattr(tr_rooms_api, "fetch_query_courses", lambda *a, **k: COURSES)
    app = FastAPI()
    app.include_router(tr_rooms_api.create_tr_rooms_router())
    return TestClient(app)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("613", "TR-613"),
        ("tr613", "TR-613"),
        ("TR 613", "TR-613"),
        ("tr-613", "TR-613"),
        ("TR613", "TR-613"),
        ("ＴＲ６１３", "TR-613"),
        ("TR-613-1", "TR-613-1"),
        ("  ", None),
        (None, None),
        ("xyz", "XYZ"),
        ("TRㄦㄉㄅㄉ", "TRㄦㄉㄅㄉ"),
    ],
)
def test_normalize_room_code(raw, expected):
    assert normalize_room_code(raw) == expected


def test_known_room_busy_and_free(client):
    busy = client.get("/api/tr-rooms/status", params={"room": "tr613", "node": "M1"})
    assert busy.status_code == 200
    assert busy.json()["room"] == "TR-613"
    assert busy.json()["room_is_free"] is False
    free = client.get("/api/tr-rooms/status", params={"room": "613", "node": "M3"})
    assert free.status_code == 200
    assert free.json()["room_is_free"] is True


def test_unknown_room_returns_404(client):
    response = client.get("/api/tr-rooms/status", params={"room": "XYZ", "node": "M1"})
    assert response.status_code == 404
    assert response.json()["detail"] == "找不到 XYZ，本學期正式課表沒有這間 TR 教室。"


def test_no_room_param_unchanged(client):
    response = client.get("/api/tr-rooms/status", params={"node": "M1"})
    assert response.status_code == 200
    body = response.json()
    assert body["room"] is None
    assert body["room_is_free"] is None
    assert body["busy_rooms"] == ["TR-613"]
