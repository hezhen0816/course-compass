from __future__ import annotations

from fastapi.testclient import TestClient

from backend import app as backend_app
from scripts.deployment import verify_production_backend


def test_healthcheck_reports_official_selection_capabilities() -> None:
    client = TestClient(backend_app.app)

    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["version"] == backend_app.API_VERSION
    assert payload["capabilities"]["school_credentials"] is True
    assert payload["capabilities"]["school_sessions"] is True
    assert payload["capabilities"]["typed_planner_read"] is True
    assert payload["capabilities"]["official_selection"] is True
    assert set(payload["capabilities"]["official_selection_actions"]) == {
        "sync",
        "keep_alive",
        "join",
        "add_to_waitlist",
        "remove",
        "reorder",
    }


def test_production_backend_verifier_accepts_required_capabilities(monkeypatch) -> None:
    def fake_fetch_json(url: str) -> dict[str, object]:
        if url.endswith("/health"):
            return {
                "ok": True,
                "capabilities": {
                    "school_credentials": True,
                    "school_sessions": True,
                    "typed_planner_read": True,
                    "official_selection": True,
                },
            }
        return {
            "paths": {
                path: {}
                for path in verify_production_backend.REQUIRED_OPENAPI_PATHS
            }
        }

    monkeypatch.setattr(verify_production_backend, "_fetch_json", fake_fetch_json)

    assert verify_production_backend.verify_backend("https://backend.example.test") == []


def test_production_backend_verifier_reports_missing_official_selection(monkeypatch) -> None:
    def fake_fetch_json(url: str) -> dict[str, object]:
        if url.endswith("/health"):
            return {"ok": True}
        return {"paths": {"/api/courses/search": {}}}

    monkeypatch.setattr(verify_production_backend, "_fetch_json", fake_fetch_json)

    issues = verify_production_backend.verify_backend("https://backend.example.test")

    assert "/health missing capabilities object" in issues
    assert "/openapi.json missing /api/planner/data" in issues
    assert "/openapi.json missing /api/official-selection/a02/sync" in issues
    assert "/openapi.json missing /api/school-credentials" in issues
