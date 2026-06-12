from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")
sys.path.insert(0, str(ROOT_DIR))

from backend import credentials  # noqa: E402


def _fetch_user_data_rows() -> list[dict[str, Any]]:
    credentials._require_service_supabase_config()
    endpoint = f"{credentials.SUPABASE_URL}/rest/v1/user_data?select=user_id,content"
    response = requests.get(
        endpoint,
        headers=credentials._service_role_headers(),
        timeout=credentials.DEFAULT_TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows if isinstance(rows, list) else []


def _save_user_content(user_id: str, content: dict[str, Any]) -> None:
    body = {
        "user_id": user_id,
        "content": content,
        "content_version": 2,
        "last_writer": "backend-maintenance",
        "updated_at": datetime.utcnow().isoformat() + "Z",
    }
    response = requests.post(
        f"{credentials.SUPABASE_URL}/rest/v1/user_data?on_conflict=user_id",
        headers=credentials._service_role_headers(json_body=True),
        json=body,
        timeout=credentials.DEFAULT_TIMEOUT,
    )
    response.raise_for_status()


def _settings(content: dict[str, Any]) -> dict[str, Any]:
    settings = content.get("settings")
    if isinstance(settings, dict):
        return settings
    settings = {}
    content["settings"] = settings
    return settings


def _legacy_username(settings: dict[str, Any]) -> str:
    credentials_payload = settings.get("schoolCredentials")
    if isinstance(credentials_payload, dict):
        username = str(credentials_payload.get("username") or "").strip()
        if username:
            return username
    return str(settings.get("school_account") or "").strip()


def _legacy_password(settings: dict[str, Any]) -> str:
    plaintext_password = str(settings.get("school_password") or "")
    if plaintext_password:
        return plaintext_password

    credentials_payload = settings.get("schoolCredentials")
    if not isinstance(credentials_payload, dict):
        return ""

    encrypted_password = str(credentials_payload.get("passwordCiphertext") or "")
    if not encrypted_password:
        return ""
    return credentials.decrypt_school_password(encrypted_password)


def migrate_legacy_school_credentials(*, apply: bool) -> dict[str, int]:
    rows = _fetch_user_data_rows()
    stats = {
        "scanned": 0,
        "eligible": 0,
        "migrated": 0,
        "skipped_missing_username": 0,
    }

    for row in rows:
        stats["scanned"] += 1
        user_id = str(row.get("user_id") or "").strip()
        content = row.get("content")
        if not user_id or not isinstance(content, dict):
            continue

        settings = _settings(content)
        legacy_password = _legacy_password(settings)
        if not legacy_password:
            continue

        username = _legacy_username(settings)
        if not username:
            stats["skipped_missing_username"] += 1
            continue

        stats["eligible"] += 1
        if not apply:
            continue

        password_ciphertext = credentials.encrypt_school_password(legacy_password)
        credentials._upsert_school_credentials_row(user_id, username, password_ciphertext)
        settings["school_account"] = username
        settings.pop("schoolCredentials", None)
        settings.pop("school_password", None)
        _save_user_content(user_id, content)
        stats["migrated"] += 1

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Migrate legacy plaintext school_password values into encrypted school_credentials rows.",
    )
    parser.add_argument("--apply", action="store_true", help="Write encrypted credentials and clear legacy plaintext.")
    args = parser.parse_args()

    try:
        stats = migrate_legacy_school_credentials(apply=args.apply)
    except credentials.CredentialStoreError as exc:
        raise SystemExit(f"configuration error: {exc}") from exc
    except requests.RequestException as exc:
        raise SystemExit(f"supabase request failed: {exc}") from exc

    mode = "apply" if args.apply else "dry-run"
    print(
        f"{mode}: scanned={stats['scanned']} eligible={stats['eligible']} "
        f"migrated={stats['migrated']} skipped_missing_username={stats['skipped_missing_username']}"
    )


if __name__ == "__main__":
    main()
