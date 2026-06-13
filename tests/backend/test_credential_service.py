from __future__ import annotations

from backend.services import credentials as credential_service


def test_credential_service_promotes_legacy_password_and_clears_plaintext() -> None:
    upserts: list[tuple[str, str, str]] = []
    saved: list[tuple[str, dict[str, object], str | None]] = []
    content = {
        "settings": {
            "school_account": "B11430207",
            "school_password": "legacy-password",
            "schoolCredentials": {"username": "B11430207", "passwordCiphertext": "old"},
        },
        "selectionPlan": {"courses": []},
    }

    credential_service.promote_legacy_school_credentials(
        "user-1",
        "B11430207",
        "legacy-password",
        "access-token",
        lambda password: f"encrypted:{password}",
        lambda user_id, username, password_ciphertext: upserts.append((user_id, username, password_ciphertext)),
        lambda user_id, access_token: content,
        lambda user_id, payload, access_token: saved.append((user_id, payload, access_token)),
    )

    assert upserts == [("user-1", "B11430207", "encrypted:legacy-password")]
    assert saved == [
        (
            "user-1",
            {
                "settings": {"school_account": "B11430207"},
                "selectionPlan": {"courses": []},
            },
            "access-token",
        )
    ]


def test_credential_service_secret_falls_back_and_promotes_legacy() -> None:
    promoted: list[tuple[str, str, str, str | None]] = []

    assert credential_service.get_school_credentials_secret(
        "user-1",
        "access-token",
        lambda user_id: None,
        lambda user_id, access_token: {
            "username": "B11430207",
            "password": "legacy-password",
            "hasPassword": True,
        },
        lambda user_id, username, password, access_token: promoted.append(
            (user_id, username, password, access_token)
        ),
        lambda password_ciphertext: f"plain:{password_ciphertext}",
        (RuntimeError,),
    ) == {
        "username": "B11430207",
        "password": "legacy-password",
        "hasPassword": True,
    }
    assert promoted == [("user-1", "B11430207", "legacy-password", "access-token")]


def test_credential_service_delete_clears_legacy_password_fields() -> None:
    deleted: list[str] = []
    saved: list[dict[str, object]] = []

    assert credential_service.delete_school_credentials(
        "user-1",
        "access-token",
        lambda user_id: deleted.append(user_id),
        lambda user_id, access_token: {
            "settings": {
                "school_account": "B11430207",
                "school_password": "legacy-password",
                "schoolCredentials": {"username": "B11430207"},
            }
        },
        lambda user_id, content, access_token: saved.append(content),
    ) == {"username": "B11430207", "hasPassword": False}

    assert deleted == ["user-1"]
    assert saved == [{"settings": {"school_account": "B11430207"}}]
