from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from backend.services import session_context


def test_current_user_context_validates_bearer_token() -> None:
    assert session_context.current_user_context(
        "Bearer access-token",
        lambda token: f"user:{token}",
    ) == ("user:access-token", "access-token")


def test_saved_school_credentials_rejects_different_username() -> None:
    with pytest.raises(HTTPException) as exc_info:
        session_context.saved_school_credentials(
            "B11430207",
            "Bearer access-token",
            lambda authorization: ("user-1", authorization or ""),
            lambda user_id, access_token: {
                "username": "B00000000",
                "password": "saved-password",
            },
        )

    assert exc_info.value.status_code == 403
    assert "帳號不同" in exc_info.value.detail


def test_reuse_official_session_restores_and_persists_saved_session() -> None:
    calls: list[str] = []

    class FakeClient:
        restored = False

        def keep_alive(self, verify_ssl: bool) -> bool:
            calls.append(f"keep_alive:{verify_ssl}:{self.restored}")
            return self.restored

        def restore_session_state(self, state: dict[str, object]) -> bool:
            calls.append(f"restore:{state['session']}")
            self.restored = True
            return True

    persisted: list[tuple[tuple[str, str] | None, str]] = []
    deleted: list[tuple[tuple[str, str] | None, str | None]] = []

    assert session_context.reuse_official_session(
        FakeClient(),
        "B11430207",
        ("user-1", "access-token"),
        False,
        lambda context, username, client: persisted.append((context, username)),
        lambda context, username=None: deleted.append((context, username)),
        lambda user_id, username: {"session_state": {"session": "saved"}},
    )

    assert calls == ["keep_alive:False:False", "restore:saved", "keep_alive:False:True"]
    assert persisted == [(("user-1", "access-token"), "B11430207")]
    assert deleted == []


def test_persist_official_session_ignores_export_errors() -> None:
    class BrokenClient:
        def export_session_state(self) -> dict[str, object]:
            raise AttributeError("missing state")

    called = False

    def fail_if_saved(*args: object, **kwargs: object) -> None:
        nonlocal called
        called = True

    session_context.persist_official_session(
        ("user-1", "access-token"),
        "B11430207",
        BrokenClient(),
        fail_if_saved,
        lambda: datetime(2026, 6, 13, tzinfo=timezone.utc),
        lambda: datetime(2026, 6, 13, tzinfo=timezone.utc),
    )

    assert called is False
