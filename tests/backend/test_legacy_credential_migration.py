from __future__ import annotations

import pytest

from scripts.migrations import migrate_legacy_school_credentials as legacy_credential_migration


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
