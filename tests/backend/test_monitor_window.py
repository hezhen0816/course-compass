from __future__ import annotations

from datetime import datetime

from backend.config import TAIPEI
from backend.monitor import worker as worker_mod


def _at(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 9, 16, hour, minute, tzinfo=TAIPEI)


def test_unset_window_monitors_all_day() -> None:
    assert worker_mod._within_monitor_window(None, None, _at(3)) is True
    assert worker_mod._within_monitor_window("08:00", None, _at(3)) is True
    assert worker_mod._within_monitor_window("", "", _at(3)) is True


def test_same_day_window() -> None:
    assert worker_mod._within_monitor_window("08:00", "23:00", _at(12)) is True
    assert worker_mod._within_monitor_window("08:00", "23:00", _at(7, 59)) is False
    assert worker_mod._within_monitor_window("08:00", "23:00", _at(23)) is False
    assert worker_mod._within_monitor_window("08:00", "23:00", _at(3)) is False


def test_window_crossing_midnight() -> None:
    """08:00-02:00 means "until 2am the next day", not "never"."""
    assert worker_mod._within_monitor_window("08:00", "02:00", _at(1)) is True
    assert worker_mod._within_monitor_window("08:00", "02:00", _at(23)) is True
    assert worker_mod._within_monitor_window("08:00", "02:00", _at(3)) is False
    assert worker_mod._within_monitor_window("08:00", "02:00", _at(7, 59)) is False


def test_postgres_time_format_is_accepted() -> None:
    assert worker_mod._within_monitor_window("08:00:00", "23:00:00", _at(12)) is True
    assert worker_mod._within_monitor_window("not a time", "23:00", _at(12)) is True
