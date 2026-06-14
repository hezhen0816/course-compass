from __future__ import annotations

from fastapi.testclient import TestClient

from backend import app as backend_app


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
