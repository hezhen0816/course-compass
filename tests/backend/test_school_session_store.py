from __future__ import annotations

from backend.repositories import school_sessions as school_session_repository
from backend.services import school_session_store as school_sessions


def test_school_session_store_round_trip_uses_service_role_rpc(monkeypatch) -> None:
    calls: list[tuple[str, dict[str, object]]] = []

    class FakeRPCResponse:
        def __init__(self, payload: object) -> None:
            self._payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self) -> object:
            return self._payload

    def fake_post(url: str, headers: dict[str, str], json: dict[str, object], timeout: int) -> FakeRPCResponse:
        calls.append((url, json))
        if url.endswith("/get_school_session"):
            return FakeRPCResponse(
                [
                    {
                        "school_account": "B11430207",
                        "session_ciphertext": "encrypted-session",
                        "key_version": 1,
                        "expires_at": "2026-06-13T04:00:00Z",
                        "last_keep_alive_at": "2026-06-13T03:30:00Z",
                    }
                ]
            )
        return FakeRPCResponse(None)

    monkeypatch.setattr(school_sessions, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(
        school_sessions,
        "_service_role_headers",
        lambda json_body=False: {"Authorization": "Bearer service"},
    )
    monkeypatch.setattr(school_sessions, "encrypt_school_session_state", lambda state: "encrypted-session")
    monkeypatch.setattr(
        school_sessions,
        "decrypt_school_session_state",
        lambda ciphertext: {"cookies": [{"name": "session", "value": "restored"}]},
    )
    monkeypatch.setattr(school_sessions.requests, "post", fake_post)

    school_sessions.save_school_session_state(
        "00000000-0000-0000-0000-000000000001",
        "B11430207",
        {"cookies": [{"name": "session", "value": "secret"}]},
    )
    loaded = school_sessions.load_school_session_state(
        "00000000-0000-0000-0000-000000000001",
        "B11430207",
    )

    assert calls[0][0] == "https://example.supabase.co/rest/v1/rpc/upsert_school_session"
    assert calls[0][1]["p_school_account"] == "B11430207"
    assert calls[0][1]["p_session_ciphertext"] == "encrypted-session"
    assert calls[1][0] == "https://example.supabase.co/rest/v1/rpc/get_school_session"
    assert loaded == {
        "school_account": "B11430207",
        "session_state": {"cookies": [{"name": "session", "value": "restored"}]},
        "expires_at": "2026-06-13T04:00:00Z",
        "last_keep_alive_at": "2026-06-13T03:30:00Z",
    }


def test_school_session_repository_writes_expected_rpc_payload() -> None:
    calls: list[tuple[str, dict[str, object], dict[str, str], int]] = []

    class FakeRPCResponse:
        def raise_for_status(self) -> None:
            return None

    def fake_post(url: str, headers: dict[str, str], json: dict[str, object], timeout: int) -> FakeRPCResponse:
        calls.append((url, json, headers, timeout))
        return FakeRPCResponse()

    school_session_repository.save_school_session_row(
        "00000000-0000-0000-0000-000000000001",
        " B11430207 ",
        "encrypted-session",
        expires_at="2026-06-13T04:00:00Z",
        last_keep_alive_at="2026-06-13T03:30:00Z",
        supabase_url="https://example.supabase.co",
        timeout=12,
        service_role_headers=lambda json_body=False: {"Authorization": f"json={json_body}"},
        post=fake_post,
    )

    assert calls == [
        (
            "https://example.supabase.co/rest/v1/rpc/upsert_school_session",
            {
                "p_user_id": "00000000-0000-0000-0000-000000000001",
                "p_school_account": "B11430207",
                "p_session_ciphertext": "encrypted-session",
                "p_expires_at": "2026-06-13T04:00:00Z",
                "p_last_keep_alive_at": "2026-06-13T03:30:00Z",
            },
            {"Authorization": "json=True"},
            12,
        )
    ]
