from __future__ import annotations

import json
import threading
import time
from datetime import timedelta

import pytest

from backend import tr_rooms
from backend.time_utils import now


@pytest.fixture(autouse=True)
def _isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("TR_COURSE_CACHE_DIR", str(tmp_path))
    tr_rooms._reset_course_cache_for_tests()
    yield tmp_path
    tr_rooms._reset_course_cache_for_tests()


def _fake_fetch(monkeypatch, *, delay=0.0, fail=False):
    calls = []
    release = threading.Event()
    release.set()

    def fake(semester, verify_ssl):
        calls.append(semester)
        release.wait(5)
        if delay:
            time.sleep(delay)
        if fail:
            raise RuntimeError("school down")
        return [{"CourseNo": f"C{len(calls)}", "ClassRoomNo": "TR-101", "Node": "M1"}]

    monkeypatch.setattr(tr_rooms, "_fetch_full_course_list", fake)
    return calls, release


def _seed(semester, age_seconds, courses=None):
    entry = tr_rooms._CacheEntry(semester, now() - timedelta(seconds=age_seconds), courses or [{"CourseNo": "OLD"}])
    tr_rooms._cache_entry = entry
    return entry


def _wait_idle():
    for _ in range(100):
        with tr_rooms._cache_lock:
            if not tr_rooms._inflight:
                return
        time.sleep(0.02)
    raise AssertionError("background refresh did not finish")


def test_stale_data_returned_immediately_and_refreshes_in_background(monkeypatch):
    calls, release = _fake_fetch(monkeypatch)
    release.clear()
    _seed("1142", tr_rooms.COURSE_CACHE_TTL_SECONDS + 10)

    courses = tr_rooms.fetch_query_courses("1142", False, True)
    assert courses == [{"CourseNo": "OLD"}]  # did not block on the held fetch
    # A second call while refresh is running must not start another fetch.
    tr_rooms.fetch_query_courses("1142", False, True)
    release.set()
    _wait_idle()
    assert len(calls) == 1
    assert tr_rooms.fetch_query_courses("1142", False, True)[0]["CourseNo"] == "C1"


def test_single_flight_for_concurrent_cold_callers(monkeypatch):
    calls, release = _fake_fetch(monkeypatch)
    release.clear()
    results = []
    threads = [
        threading.Thread(target=lambda: results.append(tr_rooms.fetch_query_courses("1142", False, True)))
        for _ in range(2)
    ]
    for t in threads:
        t.start()
    time.sleep(0.2)
    release.set()
    for t in threads:
        t.join(5)
    assert len(calls) == 1
    assert len(results) == 2 and results[0] == results[1]


def test_cold_failure_propagates_to_waiters(monkeypatch):
    _fake_fetch(monkeypatch, fail=True)
    with pytest.raises(RuntimeError, match="school down"):
        tr_rooms.fetch_query_courses("1142", False, True)
    assert not tr_rooms._inflight


def test_failed_background_refresh_keeps_serving_stale(monkeypatch):
    _fake_fetch(monkeypatch, fail=True)
    _seed("1142", tr_rooms.COURSE_CACHE_TTL_SECONDS + 10)
    assert tr_rooms.fetch_query_courses("1142", False, True) == [{"CourseNo": "OLD"}]
    _wait_idle()
    assert tr_rooms.fetch_query_courses("1142", False, True) == [{"CourseNo": "OLD"}]


def test_disk_cache_written_and_loaded_in_fresh_process(monkeypatch, _isolated_cache):
    calls, _ = _fake_fetch(monkeypatch)
    tr_rooms.fetch_query_courses("1142", False, True)
    path = _isolated_cache / "tr_courses_1142.json"
    assert json.loads(path.read_text(encoding="utf-8"))["semester"] == "1142"

    tr_rooms._reset_course_cache_for_tests()  # simulate a restart
    courses = tr_rooms.fetch_query_courses("1142", False, True)
    assert courses[0]["CourseNo"] == "C1"
    assert len(calls) == 1  # served from disk, no second fetch


def test_disk_cache_keeps_only_latest_semester(monkeypatch, _isolated_cache):
    _fake_fetch(monkeypatch)
    tr_rooms.fetch_query_courses("1141", False, True)
    tr_rooms.fetch_query_courses("1142", False, True)
    assert sorted(p.name for p in _isolated_cache.glob("*.json")) == ["tr_courses_1142.json"]


def test_refresh_does_not_block_when_data_exists(monkeypatch):
    calls, release = _fake_fetch(monkeypatch)
    release.clear()
    _seed("1142", 600)  # older than the 5 minute floor
    start = time.monotonic()
    assert tr_rooms.fetch_query_courses("1142", True, True) == [{"CourseNo": "OLD"}]
    assert time.monotonic() - start < 1
    release.set()
    _wait_idle()
    assert len(calls) == 1


def test_refresh_skipped_when_data_is_recent(monkeypatch):
    calls, _ = _fake_fetch(monkeypatch)
    _seed("1142", 30)
    tr_rooms.fetch_query_courses("1142", True, True)
    assert calls == []


@pytest.mark.parametrize("bad", ["../etc/passwd", "a/b", "1142/../x", "", "a" * 40, "11 42"])
def test_semester_with_path_chars_rejected(bad):
    with pytest.raises(RuntimeError):
        tr_rooms._cache_file(bad)
    with pytest.raises(RuntimeError):
        tr_rooms.fetch_query_courses(bad, False, True)


def test_meetings_built_once_per_course_list(monkeypatch):
    _fake_fetch(monkeypatch)
    courses = tr_rooms.fetch_query_courses("1142", False, True)
    first = tr_rooms.get_tr_meetings(courses)
    assert tr_rooms.get_tr_meetings(tr_rooms.fetch_query_courses("1142", False, True)) is first
    assert first[0].room == "TR-101"
