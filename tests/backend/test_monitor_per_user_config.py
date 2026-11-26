from __future__ import annotations

from typing import Any

from backend.monitor import worker as worker_mod

SupabaseMonitor = worker_mod.SupabaseMonitor


class _Query:
    def __init__(self, log: list[str], table: str, rows: list[dict]) -> None:
        self._log, self._table, self._rows = log, table, rows

    def select(self, columns: str) -> "_Query":
        self._log.append(f"{self._table}:select={columns}")
        return self

    def eq(self, column: str, value: str) -> "_Query":
        self._log.append(f"{self._table}?{column}=eq.{value}")
        return self

    def execute(self) -> Any:
        self._log.append(f"{self._table}:execute")
        return type("Result", (), {"data": self._rows})()


class _Admin:
    def __init__(self) -> None:
        self.calls = 0

    def get_user_by_id(self, _user_id: str) -> Any:
        self.calls += 1
        user = type("User", (), {"email": "owner@example.com"})()
        return type("AuthResponse", (), {"user": user})()


class _FakeSupabase:
    def __init__(self, rows: list[dict] | dict[str, list[dict]]) -> None:
        self.log: list[str] = []
        self._rows = rows
        self.admin = _Admin()
        self.auth = type("Auth", (), {"admin": self.admin})()

    def table(self, name: str) -> _Query:
        rows = self._rows.get(name, []) if isinstance(self._rows, dict) else self._rows
        return _Query(self.log, name, rows)


def _monitor(rows: list[dict]) -> tuple[SupabaseMonitor, _FakeSupabase, list[dict]]:
    monitor = SupabaseMonitor.__new__(SupabaseMonitor)  # no Supabase client needed
    fake = _FakeSupabase(rows)
    monitor.supabase = fake
    applied: list[dict] = []
    monitor._apply_user_settings = lambda settings, semester: applied.append(settings) or True
    monitor._current_semester_or_blank = lambda: "1151"
    return monitor, fake, applied


def test_per_user_fetch_reads_only_that_users_row() -> None:
    """Each user thread refreshes independently; scanning the whole table there is O(n^2)."""
    monitor, fake, applied = _monitor([{"user_id": "user-1"}])

    assert monitor.fetch_config_for_user("user-1") is True
    assert fake.log == [
        "user_settings:select=*",
        "user_settings?user_id=eq.user-1",
        "user_settings:execute",
    ]
    assert applied == [{"user_id": "user-1"}]


def test_missing_row_is_reported_without_raising() -> None:
    monitor, _, applied = _monitor([])

    assert monitor.fetch_config_for_user("ghost") is False
    assert applied == []


def test_manager_fetch_is_minimal_and_skips_per_user_remote_lookups() -> None:
    monitor, fake, applied = _monitor([
        {"user_id": "user-1", "is_active": True},
        {"user_id": "user-2", "is_active": False},
    ])

    assert monitor.fetch_config() is True
    assert fake.log == ["user_settings:select=user_id, is_active", "user_settings:execute"]
    assert applied == []
    assert fake.admin.calls == 0
    assert monitor.users_data == [
        {"user_id": "user-1", "is_active": True, "courses": []},
        {"user_id": "user-2", "is_active": False, "courses": []},
    ]


def test_per_user_refresh_reuses_auth_email(monkeypatch) -> None:
    fake = _FakeSupabase({
        "user_settings": [{
            "user_id": "user-1",
            "email_notify": True,
            "check_interval": 15000,
            "is_active": True,
        }],
        "monitored_courses": [],
    })
    monkeypatch.setattr(worker_mod, "create_client", lambda _url, _key: fake)
    monitor = SupabaseMonitor("https://database.example.org", "service-key")
    monitor.email_sender.configured = True
    monkeypatch.setattr(monitor, "_current_semester_or_blank", lambda: "1151")

    assert monitor.fetch_config_for_user("user-1") is True
    assert monitor.fetch_config_for_user("user-1") is True
    assert fake.admin.calls == 1
