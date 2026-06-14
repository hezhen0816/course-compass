from __future__ import annotations

from fastapi.testclient import TestClient

from backend import app as backend_app


def test_school_credentials_status_does_not_return_password(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_current_user_context", lambda authorization: ("user-1", "token-1"))
    monkeypatch.setattr(
        backend_app,
        "get_school_credentials_status",
        lambda user_id, access_token: {
            "username": "B11430207",
            "hasPassword": True,
        },
    )
    client = TestClient(backend_app.app)

    response = client.get("/api/school-credentials", headers={"Authorization": "Bearer token-1"})

    assert response.status_code == 200
    assert response.json() == {"username": "B11430207", "hasPassword": True}
