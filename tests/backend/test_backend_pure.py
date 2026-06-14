from __future__ import annotations

from datetime import datetime

import pytest
import requests
from fastapi.testclient import TestClient

from backend import app as backend_app
from backend.services import credential_store as credentials
from scripts import migrate_legacy_school_credentials as legacy_credential_migration


class FakeJSONResponse:
    def __init__(self, payload: object) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> object:
        return self._payload


class FakeAuthResponse:
    def __init__(self, payload: object, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")

    def json(self) -> object:
        return self._payload


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


def test_school_credentials_status_reads_private_rpc_without_password(monkeypatch) -> None:
    monkeypatch.setattr(credentials, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(credentials, "SUPABASE_SERVICE_ROLE_KEY", "service-role-key")

    def fake_post(url: str, headers: dict[str, str], json: dict[str, str], timeout: int) -> FakeJSONResponse:
        assert url == "https://example.supabase.co/rest/v1/rpc/get_school_credentials"
        assert json == {"p_user_id": "user-1"}
        return FakeJSONResponse(
            [
                {
                    "school_account": "B11430207",
                    "password_ciphertext": "encrypted-password",
                    "key_version": 1,
                    "last_verified_at": "2026-06-13T02:00:00Z",
                }
            ]
        )

    monkeypatch.setattr(credentials.requests, "post", fake_post)

    assert credentials.get_school_credentials_status("user-1", "access-token") == {
        "username": "B11430207",
        "hasPassword": True,
    }


def test_school_credentials_secret_decrypts_private_rpc(monkeypatch) -> None:
    monkeypatch.setattr(credentials, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(credentials, "SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    monkeypatch.setattr(credentials, "decrypt_school_password", lambda token: f"plain:{token}")
    monkeypatch.setattr(
        credentials.requests,
        "post",
        lambda url, headers, json, timeout: FakeJSONResponse(
            [
                {
                    "school_account": "B11430207",
                    "password_ciphertext": "encrypted-password",
                    "key_version": 1,
                    "last_verified_at": "2026-06-13T02:00:00Z",
                }
            ]
        ),
    )

    assert credentials.get_school_credentials_secret("user-1", "access-token") == {
        "username": "B11430207",
        "password": "plain:encrypted-password",
        "hasPassword": True,
    }


def test_school_credentials_writes_and_deletes_private_rpc(monkeypatch) -> None:
    calls: list[tuple[str, dict[str, object]]] = []

    def fake_post(url: str, headers: dict[str, str], json: dict[str, object], timeout: int) -> FakeJSONResponse:
        calls.append((url, json))
        return FakeJSONResponse(None)

    monkeypatch.setattr(credentials, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(credentials, "SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    monkeypatch.setattr(credentials.requests, "post", fake_post)

    credentials._upsert_school_credentials_row("user-1", "B11430207", "encrypted-password")
    credentials._delete_school_credentials_row("user-1")

    assert calls[0][0] == "https://example.supabase.co/rest/v1/rpc/upsert_school_credentials"
    assert calls[0][1]["p_user_id"] == "user-1"
    assert calls[0][1]["p_school_account"] == "B11430207"
    assert calls[0][1]["p_password_ciphertext"] == "encrypted-password"
    assert calls[1] == (
        "https://example.supabase.co/rest/v1/rpc/delete_school_credentials",
        {"p_user_id": "user-1"},
    )


def test_resolve_user_id_validates_token_with_supabase_auth(monkeypatch) -> None:
    calls: list[tuple[str, dict[str, str]]] = []

    def fake_get(url: str, headers: dict[str, str], timeout: int) -> FakeAuthResponse:
        calls.append((url, headers))
        return FakeAuthResponse({"id": "user-1"})

    monkeypatch.setattr(credentials, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(credentials, "SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setattr(credentials, "SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    monkeypatch.setattr(credentials.requests, "get", fake_get)

    assert credentials.resolve_user_id("access-token") == "user-1"
    assert calls == [
        (
            "https://example.supabase.co/auth/v1/user",
            {
                "apikey": "anon-key",
                "Authorization": "Bearer access-token",
                "Accept": "application/json",
            },
        )
    ]


def test_resolve_user_id_rejects_invalid_supabase_auth_token(monkeypatch) -> None:
    monkeypatch.setattr(credentials, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(credentials, "SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setattr(
        credentials.requests,
        "get",
        lambda url, headers, timeout: FakeAuthResponse({"message": "invalid jwt"}, status_code=401),
    )

    with pytest.raises(credentials.CredentialStoreError, match="登入狀態已過期或無效"):
        credentials.resolve_user_id("not-a-real-jwt")


def test_resolve_user_id_can_use_service_role_apikey_when_anon_missing(monkeypatch) -> None:
    captured_headers: list[dict[str, str]] = []

    def fake_get(url: str, headers: dict[str, str], timeout: int) -> FakeAuthResponse:
        captured_headers.append(headers)
        return FakeAuthResponse({"id": "user-1"})

    monkeypatch.setattr(credentials, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(credentials, "SUPABASE_ANON_KEY", "your-anon-key")
    monkeypatch.setattr(credentials, "SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    monkeypatch.setattr(credentials.requests, "get", fake_get)

    assert credentials.resolve_user_id("access-token") == "user-1"
    assert captured_headers[0]["apikey"] == "service-role-key"
    assert captured_headers[0]["Authorization"] == "Bearer access-token"


def test_school_credentials_rejects_placeholder_encryption_secret(monkeypatch) -> None:
    monkeypatch.setattr(
        credentials,
        "SCHOOL_CREDENTIALS_ENCRYPTION_SECRET",
        "replace-with-openssl-rand-hex-32",
    )

    with pytest.raises(credentials.CredentialStoreError, match="尚未設定校務帳密加密金鑰"):
        credentials.encrypt_school_password("password")


def test_school_credentials_rejects_short_encryption_secret(monkeypatch) -> None:
    monkeypatch.setattr(credentials, "SCHOOL_CREDENTIALS_ENCRYPTION_SECRET", "short-secret")

    with pytest.raises(credentials.CredentialStoreError, match="至少 32 字元"):
        credentials.encrypt_school_password("password")


def test_school_credentials_encryption_round_trip(monkeypatch) -> None:
    monkeypatch.setattr(credentials, "SCHOOL_CREDENTIALS_ENCRYPTION_SECRET", "x" * 32)

    token = credentials.encrypt_school_password("saved-password")

    assert token != "saved-password"
    assert credentials.decrypt_school_password(token) == "saved-password"


def test_school_credentials_status_reads_legacy_plaintext_password(monkeypatch) -> None:
    monkeypatch.setattr(credentials, "_load_school_credentials_row", lambda user_id: None)
    monkeypatch.setattr(
        credentials,
        "load_user_content",
        lambda user_id, access_token: {
            "settings": {
                "school_account": "B11430207",
                "school_password": "legacy-password",
            }
        },
    )

    assert credentials.get_school_credentials_status("user-1", "access-token") == {
        "username": "B11430207",
        "hasPassword": True,
    }


def test_school_credentials_secret_promotes_legacy_plaintext_password(monkeypatch) -> None:
    upserts: list[tuple[str, str, str]] = []
    saved: list[dict[str, object]] = []

    monkeypatch.setattr(credentials, "_load_school_credentials_row", lambda user_id: None)
    monkeypatch.setattr(
        credentials,
        "load_user_content",
        lambda user_id, access_token: {
            "settings": {
                "school_account": "B11430207",
                "school_password": "legacy-password",
            }
        },
    )
    monkeypatch.setattr(credentials, "encrypt_school_password", lambda password: f"encrypted:{password}")
    monkeypatch.setattr(
        credentials,
        "_upsert_school_credentials_row",
        lambda user_id, username, password_ciphertext: upserts.append(
            (user_id, username, password_ciphertext)
        ),
    )
    monkeypatch.setattr(
        credentials,
        "save_user_content",
        lambda user_id, content, access_token: saved.append(content),
    )

    assert credentials.get_school_credentials_secret("user-1", "access-token") == {
        "username": "B11430207",
        "password": "legacy-password",
        "hasPassword": True,
    }
    assert upserts == [("user-1", "B11430207", "encrypted:legacy-password")]
    assert saved == [{"settings": {"school_account": "B11430207"}}]


def test_legacy_credential_migration_dry_run_counts_without_writing(monkeypatch) -> None:
    monkeypatch.setattr(
        legacy_credential_migration,
        "_fetch_user_data_rows",
        lambda: [
            {
                "user_id": "user-1",
                "content": {
                    "settings": {
                        "school_account": "B11430207",
                        "school_password": "legacy-password",
                    }
                },
            },
            {
                "user_id": "user-2",
                "content": {
                    "settings": {
                        "school_password": "legacy-password-without-username",
                    }
                },
            },
            {
                "user_id": "user-3",
                "content": {
                    "settings": {
                        "school_account": "B11430208",
                    }
                },
            },
        ],
    )
    monkeypatch.setattr(
        legacy_credential_migration,
        "_upsert_school_credentials_row",
        lambda *_args: pytest.fail("dry-run must not upsert credentials"),
    )
    monkeypatch.setattr(
        legacy_credential_migration,
        "_save_user_content",
        lambda *_args: pytest.fail("dry-run must not update user_data"),
    )

    assert legacy_credential_migration.migrate_legacy_school_credentials(apply=False) == {
        "scanned": 3,
        "eligible": 1,
        "migrated": 0,
        "skipped_missing_username": 1,
    }


def test_legacy_credential_migration_apply_encrypts_and_removes_plaintext(monkeypatch) -> None:
    source_content = {
        "settings": {
            "school_account": "B11430207",
            "school_password": "legacy-password",
        },
        "selectionPlan": {"courses": []},
    }
    upserts: list[tuple[str, str, str]] = []
    saved: list[tuple[str, dict[str, object]]] = []

    monkeypatch.setattr(
        legacy_credential_migration,
        "_fetch_user_data_rows",
        lambda: [{"user_id": "user-1", "content": source_content}],
    )
    monkeypatch.setattr(
        legacy_credential_migration.credentials,
        "encrypt_school_password",
        lambda password: f"encrypted:{password}",
    )
    monkeypatch.setattr(
        legacy_credential_migration,
        "_upsert_school_credentials_row",
        lambda user_id, username, password_ciphertext: upserts.append(
            (user_id, username, password_ciphertext)
        ),
    )
    monkeypatch.setattr(
        legacy_credential_migration,
        "_save_user_content",
        lambda user_id, content: saved.append((user_id, content)),
    )

    assert legacy_credential_migration.migrate_legacy_school_credentials(apply=True) == {
        "scanned": 1,
        "eligible": 1,
        "migrated": 1,
        "skipped_missing_username": 0,
    }
    assert upserts == [("user-1", "B11430207", "encrypted:legacy-password")]
    assert saved == [
        (
            "user-1",
            {
                "settings": {"school_account": "B11430207"},
                "selectionPlan": {"courses": []},
            },
        )
    ]


def test_legacy_credential_migration_handles_old_ciphertext_payload(monkeypatch) -> None:
    source_content = {
        "settings": {
            "schoolCredentials": {
                "username": "B11430207",
                "passwordCiphertext": "legacy-ciphertext",
            }
        }
    }
    upserts: list[tuple[str, str, str]] = []
    saved: list[dict[str, object]] = []

    monkeypatch.setattr(
        legacy_credential_migration,
        "_fetch_user_data_rows",
        lambda: [{"user_id": "user-1", "content": source_content}],
    )
    monkeypatch.setattr(
        legacy_credential_migration.credentials,
        "decrypt_school_password",
        lambda token: f"plain:{token}",
    )
    monkeypatch.setattr(
        legacy_credential_migration.credentials,
        "encrypt_school_password",
        lambda password: f"new:{password}",
    )
    monkeypatch.setattr(
        legacy_credential_migration,
        "_upsert_school_credentials_row",
        lambda user_id, username, password_ciphertext: upserts.append(
            (user_id, username, password_ciphertext)
        ),
    )
    monkeypatch.setattr(
        legacy_credential_migration,
        "_save_user_content",
        lambda _user_id, content: saved.append(content),
    )

    assert legacy_credential_migration.migrate_legacy_school_credentials(apply=True)["migrated"] == 1
    assert upserts == [("user-1", "B11430207", "new:plain:legacy-ciphertext")]
    assert saved == [{"settings": {"school_account": "B11430207"}}]


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
