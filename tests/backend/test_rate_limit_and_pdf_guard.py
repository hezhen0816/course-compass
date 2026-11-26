from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import app as backend_app
from backend import rate_limit


def _limited_app(max_requests: int) -> tuple[TestClient, list[float]]:
    clock = [0.0]
    app = FastAPI()

    @app.get("/api/courses/search")
    def search() -> dict[str, str]:
        return {"ok": "1"}

    @app.get("/api/other")
    def other() -> dict[str, str]:
        return {"ok": "1"}

    rate_limit.install(
        app,
        rate_limit.SlidingWindowLimiter({"/api/courses/search": (max_requests, 60)}, clock=lambda: clock[0]),
    )
    return TestClient(app), clock


def test_rate_limit_blocks_the_next_request_after_the_window_fills() -> None:
    client, clock = _limited_app(2)
    assert client.get("/api/courses/search").status_code == 200
    assert client.get("/api/courses/search").status_code == 200
    blocked = client.get("/api/courses/search")
    assert blocked.status_code == 429
    assert blocked.headers["Retry-After"]
    # unrelated routes are untouched
    assert client.get("/api/other").status_code == 200
    # the window slides: once the oldest hit is 60 s old a slot frees up
    clock[0] = 61.0
    assert client.get("/api/courses/search").status_code == 200


def test_rate_limit_is_per_client_using_forwarded_for() -> None:
    client, _clock = _limited_app(1)
    assert client.get("/api/courses/search", headers={"X-Forwarded-For": "203.0.113.1"}).status_code == 200
    assert client.get("/api/courses/search", headers={"X-Forwarded-For": "203.0.113.1"}).status_code == 429
    assert client.get("/api/courses/search", headers={"X-Forwarded-For": "203.0.113.2"}).status_code == 200


def test_pdf_import_requires_login_and_caps_size(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "resolve_user_id", lambda token: "user-1")
    parsed = {
        "requirement_set": {
            "id": "set-1", "name": "x", "department": "", "source": "pdf",
            "source_file_name": "x.pdf", "total_credits": None, "notes": [],
        },
        "pending_requirements": [],
        "warnings": [],
        "raw_text_preview": "",
    }
    monkeypatch.setattr(backend_app, "parse_requirement_pdf", lambda pdf_bytes, filename: parsed)
    client = TestClient(backend_app.app)
    files = {"file": ("x.pdf", b"%PDF-1.4 tiny", "application/pdf")}

    assert client.post("/api/planner/import-requirements/pdf", files=files).status_code == 401

    ok = client.post("/api/planner/import-requirements/pdf", files=files, headers={"Authorization": "Bearer t"})
    assert ok.status_code == 200

    big = {"file": ("x.pdf", b"0" * (8 * 1024 * 1024 + 1), "application/pdf")}
    too_big = client.post("/api/planner/import-requirements/pdf", files=big, headers={"Authorization": "Bearer t"})
    assert too_big.status_code == 413
