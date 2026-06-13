from __future__ import annotations

from datetime import datetime, timezone

import pytest

from backend.credentials import CredentialStoreError
from backend.services import school_sessions as school_session_service


def test_school_session_service_encrypts_ascii_json_payload() -> None:
    encrypted_inputs: list[str] = []

    result = school_session_service.encrypt_school_session_state(
        {"cookies": [{"name": "session", "value": "秘密"}]},
        lambda raw: encrypted_inputs.append(raw) or "encrypted-session",
    )

    assert result == "encrypted-session"
    assert encrypted_inputs == ['{"cookies":[{"name":"session","value":"\\u79d8\\u5bc6"}]}']


def test_school_session_service_rejects_non_object_state() -> None:
    with pytest.raises(CredentialStoreError, match="格式錯誤"):
        school_session_service.decrypt_school_session_state(
            "encrypted-session",
            lambda ciphertext: '["not", "an", "object"]',
        )


def test_school_session_service_saves_row_with_default_times() -> None:
    saved: list[tuple[str, str, str, str, str]] = []

    school_session_service.save_school_session_state(
        "user-1",
        "B11430207",
        {"cookies": []},
        lambda user_id, username, ciphertext, expires_at, last_keep_alive_at: saved.append(
            (user_id, username, ciphertext, expires_at, last_keep_alive_at)
        ),
        lambda state: "encrypted-session",
        lambda: datetime(2026, 6, 13, 4, 0, tzinfo=timezone.utc),
        lambda: datetime(2026, 6, 13, 3, 30, tzinfo=timezone.utc),
    )

    assert saved == [
        (
            "user-1",
            "B11430207",
            "encrypted-session",
            "2026-06-13T04:00:00+00:00",
            "2026-06-13T03:30:00+00:00",
        )
    ]
