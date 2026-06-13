from __future__ import annotations

try:
    from .services import snapshots as _snapshots_service
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from services import snapshots as _snapshots_service  # type: ignore

DEFAULT_TIMEOUT = _snapshots_service.DEFAULT_TIMEOUT
SUPABASE_SERVICE_ROLE_KEY = _snapshots_service.SUPABASE_SERVICE_ROLE_KEY
SUPABASE_URL = _snapshots_service.SUPABASE_URL
requests = _snapshots_service.requests


def _sync_service_dependencies() -> None:
    _snapshots_service.DEFAULT_TIMEOUT = DEFAULT_TIMEOUT
    _snapshots_service.SUPABASE_SERVICE_ROLE_KEY = SUPABASE_SERVICE_ROLE_KEY
    _snapshots_service.SUPABASE_URL = SUPABASE_URL
    _snapshots_service.requests = requests


def persist_snapshot(profile_key: str, school_account: str, payload: dict) -> bool:
    _sync_service_dependencies()
    return _snapshots_service.persist_snapshot(profile_key, school_account, payload)


def load_snapshot(profile_key: str) -> dict | None:
    _sync_service_dependencies()
    return _snapshots_service.load_snapshot(profile_key)


def ensure_schedule_entry_slot_times(payload: dict) -> dict:
    return _snapshots_service.ensure_schedule_entry_slot_times(payload)


def persist_history_snapshot(profile_key: str, school_account: str, payload: dict) -> bool:
    _sync_service_dependencies()
    return _snapshots_service.persist_history_snapshot(profile_key, school_account, payload)


def load_history_snapshot(profile_key: str) -> dict | None:
    _sync_service_dependencies()
    return _snapshots_service.load_history_snapshot(profile_key)


def persist_moodle_assignments_snapshot(profile_key: str, school_account: str, payload: dict) -> bool:
    _sync_service_dependencies()
    return _snapshots_service.persist_moodle_assignments_snapshot(profile_key, school_account, payload)


def load_moodle_assignments_snapshot(profile_key: str) -> dict | None:
    _sync_service_dependencies()
    return _snapshots_service.load_moodle_assignments_snapshot(profile_key)
