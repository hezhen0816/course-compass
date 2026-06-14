from __future__ import annotations

from fastapi.testclient import TestClient

from backend import app as backend_app


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
