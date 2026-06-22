from __future__ import annotations

from fastapi.testclient import TestClient

from backend import app as backend_app


def test_planner_data_api_returns_typed_data_for_current_user(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_current_user_context", lambda authorization: ("user-1", "token-1"))
    monkeypatch.setattr(
        backend_app,
        "read_typed_planner_app_data",
        lambda user_id: {
            "schemaVersion": 3,
            "settings": {},
            "semesters": [],
            "requirementSets": [],
            "pendingRequirements": [],
            "historyRecords": [],
        },
    )
    client = TestClient(backend_app.app)

    response = client.get("/api/planner/data", headers={"Authorization": "Bearer token-1"})

    assert response.status_code == 200
    assert response.json() == {
        "source": "typed",
        "data": {
            "schemaVersion": 3,
            "settings": {},
            "semesters": [],
            "requirementSets": [],
            "pendingRequirements": [],
            "historyRecords": [],
        },
    }
