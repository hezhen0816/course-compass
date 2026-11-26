from __future__ import annotations

from typing import Any

from backend.monitor import worker as worker_mod
from backend.monitor.config import CourseConfig
from backend.monitor.monitor import CourseMonitor


class _UpdateQuery:
    def __init__(self, client: "_FakeSupabase", data: dict[str, Any]) -> None:
        self.client = client
        self.data = data
        self.filters: list[tuple[str, str, Any]] = []

    def eq(self, column: str, value: Any) -> "_UpdateQuery":
        self.filters.append(("eq", column, value))
        return self

    def neq(self, column: str, value: Any) -> "_UpdateQuery":
        self.filters.append(("neq", column, value))
        return self

    def execute(self) -> Any:
        matches = all(
            self.client.row.get(column) == value if operator == "eq"
            else self.client.row.get(column) != value
            for operator, column, value in self.filters
        )
        self.client.updates.append((self.data, list(self.filters)))
        if matches:
            self.client.row.update(self.data)
            return type("Result", (), {"data": [dict(self.client.row)]})()
        return type("Result", (), {"data": []})()


class _Table:
    def __init__(self, client: "_FakeSupabase") -> None:
        self.client = client

    def update(self, data: dict[str, Any]) -> _UpdateQuery:
        return _UpdateQuery(self.client, data)


class _FakeSupabase:
    def __init__(self, status: str) -> None:
        self.row: dict[str, Any] = {"id": "row-1", "status": status}
        self.updates: list[tuple[dict[str, Any], list[tuple[str, str, Any]]]] = []

    def table(self, name: str) -> _Table:
        assert name == "monitored_courses"
        return _Table(self)


def _monitor(monkeypatch, status: str) -> tuple[worker_mod.SupabaseMonitor, _FakeSupabase]:
    fake = _FakeSupabase(status)
    monkeypatch.setattr(worker_mod, "create_client", lambda _url, _key: fake)
    monkeypatch.setattr(CourseMonitor, "check_course", lambda _self, _course: True)
    monitor = worker_mod.SupabaseMonitor("http://supabase.local", "service-key")
    monitor.enrollment_period = "A06"
    monkeypatch.setattr(
        monitor,
        "get_course_state",
        lambda _identifier: {
            "course_info": {
                "CourseName": "Algorithms",
                "Semester": "1151",
                "Restrict1": "50",
                "ChooseStudent": "42",
            },
            "count": 42,
            "previous_count": 42,
        },
    )
    monkeypatch.setattr(monitor, "_note_query_success", lambda _identifier: None)
    return monitor, fake


def _course() -> CourseConfig:
    course = CourseConfig(course_no="CS1001", course_name="Algorithms", semester="1151")
    course.db_id = "row-1"
    return course


def test_course_refresh_updates_monitoring_row_in_one_request(monkeypatch) -> None:
    monitor, fake = _monitor(monkeypatch, "monitoring")

    assert monitor.check_course(_course()) is True
    assert len(fake.updates) == 1
    assert fake.updates[0][0]["status"] == "monitoring"
    assert ("neq", "status", "enrolled") in fake.updates[0][1]


def test_course_refresh_preserves_enrolled_status_and_refreshes_non_status_fields(monkeypatch) -> None:
    monitor, fake = _monitor(monkeypatch, "enrolled")

    assert monitor.check_course(_course()) is True
    assert len(fake.updates) == 2
    assert fake.row["status"] == "enrolled"
    assert fake.row["current_enrolled"] == "42/50"
    assert "last_check_time" in fake.row
    assert "status" not in fake.updates[1][0]
    assert ("eq", "status", "enrolled") in fake.updates[1][1]
