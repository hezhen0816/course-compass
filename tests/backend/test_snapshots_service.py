from __future__ import annotations

from backend.repositories import snapshots as snapshot_repository
from backend.services import snapshots


def test_supabase_load_snapshot_builds_encoded_query(monkeypatch) -> None:
    seen: dict[str, object] = {}
    monkeypatch.setattr(snapshots, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(snapshots, "SUPABASE_SERVICE_ROLE_KEY", "service-key")

    class Response:
        status_code = 200
        text = "ok"

        @staticmethod
        def json() -> list[dict[str, object]]:
            return [{"payload": {"ok": True}}]

    def fake_get(url: str, **kwargs: object) -> Response:
        seen["url"] = url
        seen["headers"] = kwargs["headers"]
        return Response()

    monkeypatch.setattr(snapshots.requests, "get", fake_get)

    assert snapshots.load_snapshot("abc/123") == {"ok": True}
    assert seen["url"] == (
        "https://example.supabase.co/rest/v1/schedule_sync_snapshots"
        "?profile_key=eq.abc%2F123&select=payload"
    )


def test_snapshot_repository_builds_encoded_query() -> None:
    seen: dict[str, object] = {}

    class Response:
        status_code = 200
        text = "ok"

        @staticmethod
        def json() -> list[dict[str, object]]:
            return [{"payload": {"ok": True}}]

    def fake_get(url: str, **kwargs: object) -> Response:
        seen["url"] = url
        seen["headers"] = kwargs["headers"]
        seen["timeout"] = kwargs["timeout"]
        return Response()

    assert snapshot_repository.load_snapshot_row(
        "schedule_sync_snapshots",
        "abc/123",
        supabase_url="https://example.supabase.co",
        headers={"Authorization": "Bearer service"},
        timeout=12,
        get=fake_get,
    ) == {"ok": True}
    assert seen == {
        "url": (
            "https://example.supabase.co/rest/v1/schedule_sync_snapshots"
            "?profile_key=eq.abc%2F123&select=payload"
        ),
        "headers": {"Authorization": "Bearer service"},
        "timeout": 12,
    }


def test_supabase_persist_snapshot_reuses_common_writer(monkeypatch) -> None:
    seen: dict[str, object] = {}
    monkeypatch.setattr(snapshots, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(snapshots, "SUPABASE_SERVICE_ROLE_KEY", "service-key")

    class Response:
        status_code = 201
        text = "created"

    def fake_post(url: str, **kwargs: object) -> Response:
        seen["url"] = url
        seen["json"] = kwargs["json"]
        seen["headers"] = kwargs["headers"]
        return Response()

    monkeypatch.setattr(snapshots.requests, "post", fake_post)

    assert snapshots.persist_history_snapshot(
        profile_key="profile",
        school_account="student",
        payload={
            "imported_at": "2026-04-13T10:00:00+08:00",
            "student_name": "測試學生",
            "records": [],
        },
    )
    assert seen["url"] == "https://example.supabase.co/rest/v1/history_import_snapshots"
    assert seen["json"] == {
        "profile_key": "profile",
        "school_account": "student",
        "payload": {
            "imported_at": "2026-04-13T10:00:00+08:00",
            "student_name": "測試學生",
            "records": [],
        },
        "imported_at": "2026-04-13T10:00:00+08:00",
        "student_name": "測試學生",
    }
