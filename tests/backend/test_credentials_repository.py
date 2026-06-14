from __future__ import annotations

from backend.repositories import credentials as credential_repository


def test_school_credentials_repository_writes_expected_rpc_payload() -> None:
    calls: list[tuple[str, dict[str, object], dict[str, str], int]] = []

    class FakeRPCResponse:
        def raise_for_status(self) -> None:
            return None

    def fake_post(url: str, headers: dict[str, str], json: dict[str, object], timeout: int) -> FakeRPCResponse:
        calls.append((url, json, headers, timeout))
        return FakeRPCResponse()

    credential_repository.upsert_school_credentials_row(
        "user-1",
        "B11430207",
        "encrypted-password",
        key_version=1,
        last_verified_at="2026-06-13T02:00:00+00:00",
        supabase_url="https://example.supabase.co",
        timeout=12,
        service_role_headers=lambda json_body=False: {"Authorization": f"json={json_body}"},
        post=fake_post,
    )

    assert calls == [
        (
            "https://example.supabase.co/rest/v1/rpc/upsert_school_credentials",
            {
                "p_user_id": "user-1",
                "p_school_account": "B11430207",
                "p_password_ciphertext": "encrypted-password",
                "p_key_version": 1,
                "p_last_verified_at": "2026-06-13T02:00:00+00:00",
            },
            {"Authorization": "json=True"},
            12,
        )
    ]


def test_credential_repository_loads_user_content() -> None:
    calls: list[tuple[str, dict[str, str], int]] = []

    class FakeUserDataResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> object:
            return [{"content": {"schemaVersion": 2, "settings": {"school_account": "B11430207"}}}]

    def fake_get(url: str, headers: dict[str, str], timeout: int) -> FakeUserDataResponse:
        calls.append((url, headers, timeout))
        return FakeUserDataResponse()

    content = credential_repository.load_user_content(
        "user/1",
        supabase_url="https://example.supabase.co",
        headers={"Authorization": "Bearer token"},
        timeout=12,
        get=fake_get,
    )

    assert calls == [
        (
            "https://example.supabase.co/rest/v1/user_data?user_id=eq.user%2F1&select=content",
            {"Authorization": "Bearer token"},
            12,
        )
    ]
    assert content == {"schemaVersion": 2, "settings": {"school_account": "B11430207"}}


def test_credential_repository_saves_user_content() -> None:
    calls: list[tuple[str, dict[str, str], dict[str, object], int]] = []

    class FakeUserDataResponse:
        def raise_for_status(self) -> None:
            return None

    def fake_post(url: str, headers: dict[str, str], json: dict[str, object], timeout: int) -> FakeUserDataResponse:
        calls.append((url, headers, json, timeout))
        return FakeUserDataResponse()

    credential_repository.save_user_content(
        "user-1",
        {"schemaVersion": 2, "settings": {}},
        supabase_url="https://example.supabase.co",
        headers={"Authorization": "Bearer token"},
        timeout=12,
        updated_at="2026-06-14T13:00:00+00:00",
        post=fake_post,
    )

    assert calls == [
        (
            "https://example.supabase.co/rest/v1/user_data?on_conflict=user_id",
            {"Authorization": "Bearer token"},
            {
                "user_id": "user-1",
                "content": {"schemaVersion": 2, "settings": {}},
                "content_version": 2,
                "last_writer": "backend",
                "updated_at": "2026-06-14T13:00:00+00:00",
            },
            12,
        )
    ]


def test_credential_repository_lists_user_content_rows() -> None:
    calls: list[tuple[str, dict[str, str], int]] = []

    class FakeUserDataResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> object:
            return [{"user_id": "user-1", "content": {"settings": {}}}]

    def fake_get(url: str, headers: dict[str, str], timeout: int) -> FakeUserDataResponse:
        calls.append((url, headers, timeout))
        return FakeUserDataResponse()

    rows = credential_repository.list_user_data_content_rows(
        supabase_url="https://example.supabase.co",
        headers={"Authorization": "Bearer service"},
        timeout=12,
        get=fake_get,
    )

    assert calls == [
        (
            "https://example.supabase.co/rest/v1/user_data?select=user_id,content",
            {"Authorization": "Bearer service"},
            12,
        )
    ]
    assert rows == [{"user_id": "user-1", "content": {"settings": {}}}]
