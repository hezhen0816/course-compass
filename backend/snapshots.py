from __future__ import annotations

from typing import Any

import requests

try:
    from .config import DEFAULT_TIMEOUT, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
    from .integrations.schedule import group_schedule_entries
    from .repositories import snapshots as snapshot_repository
except ImportError:  # pragma: no cover
    from config import DEFAULT_TIMEOUT, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
    from integrations.schedule import group_schedule_entries
    from repositories import snapshots as snapshot_repository


def _supabase_headers(content_type: bool = False) -> dict[str, str]:
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }
    if content_type:
        headers["Content-Type"] = "application/json"
        headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    return headers


def _persist_snapshot(table: str, timestamp_field: str, profile_key: str, school_account: str, payload: dict[str, Any]) -> bool:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return False

    return snapshot_repository.persist_snapshot_row(
        table,
        timestamp_field,
        profile_key,
        school_account,
        payload,
        supabase_url=SUPABASE_URL,
        headers=_supabase_headers(content_type=True),
        timeout=DEFAULT_TIMEOUT,
        post=requests.post,
    )


def _load_snapshot(table: str, profile_key: str) -> dict[str, Any] | None:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return None

    return snapshot_repository.load_snapshot_row(
        table,
        profile_key,
        supabase_url=SUPABASE_URL,
        headers=_supabase_headers(),
        timeout=DEFAULT_TIMEOUT,
        get=requests.get,
    )


def persist_snapshot(profile_key: str, school_account: str, payload: dict[str, Any]) -> bool:
    return _persist_snapshot("schedule_sync_snapshots", "synced_at", profile_key, school_account, payload)


def load_snapshot(profile_key: str) -> dict[str, Any] | None:
    return _load_snapshot("schedule_sync_snapshots", profile_key)


def ensure_schedule_entry_slot_times(payload: dict[str, Any]) -> dict[str, Any]:
    schedule_entries = payload.get("schedule_entries")
    if not isinstance(schedule_entries, list) or not schedule_entries:
        return payload

    if all(isinstance(entry, dict) and entry.get("slot_times") for entry in schedule_entries):
        return payload

    courses = payload.get("courses")
    slots = payload.get("slots")
    if not isinstance(courses, list) or not isinstance(slots, list):
        return payload

    rebuilt_entries = group_schedule_entries(courses, slots)
    return {
        **payload,
        "schedule_entries": rebuilt_entries,
        "schedule_entry_count": len(rebuilt_entries),
    }


def persist_history_snapshot(profile_key: str, school_account: str, payload: dict[str, Any]) -> bool:
    return _persist_snapshot("history_import_snapshots", "imported_at", profile_key, school_account, payload)


def load_history_snapshot(profile_key: str) -> dict[str, Any] | None:
    return _load_snapshot("history_import_snapshots", profile_key)


def persist_moodle_assignments_snapshot(profile_key: str, school_account: str, payload: dict[str, Any]) -> bool:
    return _persist_snapshot("moodle_assignment_snapshots", "synced_at", profile_key, school_account, payload)


def load_moodle_assignments_snapshot(profile_key: str) -> dict[str, Any] | None:
    return _load_snapshot("moodle_assignment_snapshots", profile_key)
