from __future__ import annotations

from backend.monitor import worker as worker_mod


def test_sub_second_setting_is_raised_to_the_floor() -> None:
    """Supabase held check_interval=30 (ms) for one account, i.e. 0.03s per loop."""
    assert worker_mod._safe_check_interval(0.03) == worker_mod.MIN_CHECK_INTERVAL_SECONDS


def test_zero_and_broken_values_fall_back_to_the_default() -> None:
    floor = worker_mod.MIN_CHECK_INTERVAL_SECONDS
    assert worker_mod._safe_check_interval(0) == floor
    assert worker_mod._safe_check_interval(None) == floor
    assert worker_mod._safe_check_interval("") == floor
    assert worker_mod._safe_check_interval(-5) == floor


def test_generous_settings_are_kept() -> None:
    assert worker_mod._safe_check_interval(45.0) == 45.0


def test_next_interval_never_dips_below_the_floor() -> None:
    draws = [worker_mod._next_interval(0.03, 5.0) for _ in range(200)]
    assert min(draws) >= worker_mod.MIN_CHECK_INTERVAL_SECONDS


def test_next_interval_does_not_pile_up_on_the_floor() -> None:
    """Jitter runs upward: clamping ±jitter would land half the rounds on exactly 15.0s."""
    floor = worker_mod.MIN_CHECK_INTERVAL_SECONDS
    draws = [worker_mod._next_interval(floor, 5.0) for _ in range(200)]
    exactly_on_floor = sum(1 for d in draws if d == floor)
    assert exactly_on_floor <= 2
    assert max(draws) <= floor + 5.0


def test_next_interval_without_jitter_is_the_base() -> None:
    assert worker_mod._next_interval(30.0, 0) == 30.0
