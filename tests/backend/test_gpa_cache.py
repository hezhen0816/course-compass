from __future__ import annotations

import backend.gpa as gpa


class _Resp:
    def __init__(self, status_code=200, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {"success": True, "data": {"gpa": 3.5}}
        self.headers = headers or {}

    def json(self):
        return self._payload


def _patch(monkeypatch, responses):
    calls: list[str] = []

    def fake_get(url, headers, timeout, verify):
        course = url.rsplit("/", 1)[-1]
        calls.append(course)
        result = responses(course) if callable(responses) else responses
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(gpa.requests, "get", fake_get)
    return calls


def setup_function() -> None:
    gpa.clear_cache()


def test_second_lookup_of_same_course_is_cached(monkeypatch) -> None:
    calls = _patch(monkeypatch, _Resp())
    assert gpa.fetch_course_gpa("cs1234", "key", False) == (3.5, "found")
    assert gpa.fetch_course_gpa("CS1234", "key", False) == (3.5, "found")
    assert calls == ["CS1234"]


def test_no_data_is_cached_but_errors_are_not(monkeypatch) -> None:
    calls = _patch(monkeypatch, _Resp(status_code=404))
    gpa.fetch_course_gpa("A1", "key", False)
    gpa.fetch_course_gpa("A1", "key", False)
    assert calls == ["A1"]

    gpa.clear_cache()
    calls = _patch(monkeypatch, _Resp(status_code=500))
    assert gpa.fetch_course_gpa("B1", "key", False) == (None, "error")
    assert gpa.fetch_course_gpa("B1", "key", False) == (None, "error")
    assert calls == ["B1", "B1"]


def _fake_clock(monkeypatch):
    clock = [1_000_000.0]
    slept: list[float] = []
    monkeypatch.setattr(gpa.time, "time", lambda: clock[0])

    def sleep(seconds: float) -> None:
        slept.append(seconds)
        clock[0] += seconds

    monkeypatch.setattr(gpa.time, "sleep", sleep)
    return slept


def test_429_waits_out_the_retry_after_then_retries_once(monkeypatch) -> None:
    slept = _fake_clock(monkeypatch)
    calls = _patch(monkeypatch, _Resp(status_code=429, headers={"Retry-After": "30"}))
    assert gpa.fetch_course_gpa("C1", "key", False) == (None, "rate_limited")
    assert calls == ["C1", "C1"] and slept and slept[0] >= 29  # one retry after honouring Retry-After


def test_429_pause_longer_than_the_budget_gives_up_without_calling(monkeypatch) -> None:
    _fake_clock(monkeypatch)
    calls = _patch(monkeypatch, _Resp(status_code=429, headers={"Retry-After": "300"}))
    assert gpa.fetch_course_gpa("C1", "key", False) == (None, "rate_limited")
    assert calls == ["C1"]  # Retry-After 300 s exceeds MAX_WAIT_SECONDS, so no retry
    assert gpa.fetch_course_gpa("C2", "key", False) == (None, "rate_limited")
    assert calls == ["C1"]  # still paused, C2 never leaves the process


def test_batch_dedupes_and_uses_cache(monkeypatch) -> None:
    calls = _patch(monkeypatch, lambda c: _Resp(payload={"success": True, "data": {"gpa": 4.0}}))
    out = gpa.fetch_course_gpas(["X1", "x1", "X2", ""], "key", False)
    assert out == {"X1": (4.0, "found"), "X2": (4.0, "found")}
    assert sorted(calls) == ["X1", "X2"]

    out2 = gpa.fetch_course_gpas(["X1", "X2"], "key", False)
    assert out2 == out
    assert sorted(calls) == ["X1", "X2"]


def test_batch_without_key_reports_not_enabled(monkeypatch) -> None:
    assert gpa.fetch_course_gpas(["X1"], "  ", False) == {"X1": (None, "not_enabled")}


def test_supabase_grade_hit_short_circuits_myntust(monkeypatch) -> None:
    record = gpa.GradeRecord(3.8, "found", 1142, 42, {"A": 12})
    monkeypatch.setattr(gpa.myntust_cache, "load_grades", lambda course_nos: {"CS1": record})
    calls = _patch(monkeypatch, _Resp(status_code=500))

    assert gpa.fetch_course_gpa("cs1", "key", False) == (3.8, "found")
    assert calls == []


# --- section attribution -------------------------------------------------------

def _history(rows):
    return {
        "success": True,
        "data": [
            {"course_no": c, "course_name": n, "lecturer": t, "semester": s}
            for c, n, t, s in rows
        ],
        "pagination": {"has_next": False},
    }


def _grade(gpa, semester, students=40):
    return {"success": True, "data": {"gpa": gpa, "semester": semester, "total_students": students}}


def _patch_api(monkeypatch, grades: dict, history: dict | None):
    calls: list[str] = []

    def fake_get(url, headers, timeout, verify, params=None):
        if url == gpa.COURSE_HISTORY_API_URL:
            calls.append(f"history:{params['keyword']}")
            if history is None:
                return _Resp(status_code=500, payload={})
            return _Resp(payload=_history(history.get(params["keyword"], [])))
        course = url.rsplit("/", 1)[-1]
        calls.append(course)
        if course not in grades:
            return _Resp(status_code=404, payload={"success": False})
        return _Resp(payload=grades[course])

    monkeypatch.setattr(gpa.requests, "get", fake_get)
    return calls


def test_gpa_taught_by_same_teacher_is_attributed_with_semester(monkeypatch) -> None:
    calls = _patch_api(
        monkeypatch,
        {"BA2201301": _grade(3.54, 1142, 48)},
        {"行銷管理": [("BA2201301", "行銷管理", "梁浩怡", 1142), ("BA2201301", "行銷管理", "梁浩怡", 1151)]},
    )
    out = gpa.resolve_section_gpa("BA2201301", "行銷管理", "梁浩怡", "key", False)
    assert out == gpa.GpaResult(3.54, "found", 1142, 48, "梁浩怡", "BA2201301")
    assert calls == ["BA2201301", "history:行銷管理"]


def test_gpa_from_another_teachers_year_falls_back_to_that_teachers_section(monkeypatch) -> None:
    # The code's latest grades (1142) were 測試教師1's class; 梁浩怡 taught it in 1151
    # (no grades yet) and BA2201302 in 1141 — that is the number to show.
    calls = _patch_api(
        monkeypatch,
        {"BA2201301": _grade(3.54, 1142), "BA2201302": _grade(3.12, 1141, 55)},
        {
            "行銷管理": [
                ("BA2201301", "行銷管理", "測試教師1", 1142),
                ("BA2201301", "行銷管理", "梁浩怡", 1151),
                ("BA2201302", "行銷管理", "梁浩怡", 1141),
            ]
        },
    )
    out = gpa.resolve_section_gpa("BA2201301", "行銷管理", "梁浩怡", "key", False)
    assert out == gpa.GpaResult(3.12, "found", 1141, 55, "梁浩怡", "BA2201302")
    assert calls == ["BA2201301", "history:行銷管理", "BA2201302"]


def test_gpa_of_other_teacher_is_labelled_not_hidden(monkeypatch) -> None:
    _patch_api(
        monkeypatch,
        {"BA2201301": _grade(3.54, 1142)},
        {"行銷管理": [("BA2201301", "行銷管理", "測試教師1", 1142), ("BA2201301", "行銷管理", "梁浩怡", 1151)]},
    )
    out = gpa.resolve_section_gpa("BA2201301", "行銷管理", "梁浩怡", "key", False)
    assert out.status == "other_teacher" and out.gpa == 3.54 and out.teacher == "測試教師1"


def test_history_unavailable_keeps_code_level_gpa_unverified(monkeypatch) -> None:
    _patch_api(monkeypatch, {"CS1": _grade(3.0, 1141)}, None)
    out = gpa.resolve_section_gpa("CS1", "演算法", "王紹睿", "key", False)
    assert out == gpa.GpaResult(3.0, "found", 1141, 40, None, "CS1")


def test_history_only_matches_the_exact_course_name(monkeypatch) -> None:
    calls = _patch_api(
        monkeypatch,
        {"CS3005301": _grade(2.08, 1142)},
        {"物件導向程式設計": [("CS1010301", "物件導向程式設計實習", "測試教師2", 1142), ("CS3005301", "物件導向程式設計", "測試教師2", 1142)]},
    )
    rows = gpa.fetch_course_history("物件導向程式設計", "key", False)
    assert [r.course_no for r in rows] == ["CS3005301"]
    assert gpa.fetch_course_history("物件導向程式設計", "key", False) is rows  # cached
    assert calls == ["history:物件導向程式設計"]


def test_section_batch_dedupes_and_disabled_key(monkeypatch) -> None:
    calls = _patch_api(monkeypatch, {"A1": _grade(3.3, 1141)}, {"甲": [("A1", "甲", "師", 1141)]})
    out = gpa.fetch_section_gpas([("a1", "甲", "師"), ("A1", "甲", "師")], "key", False)
    assert out["A1"].gpa == 3.3 and calls == ["A1", "history:甲"]
    assert gpa.fetch_section_gpas([("A1", "甲", "師")], " ", False) == {"A1": gpa.GpaResult(None, "not_enabled")}


def test_gpa_history_attaches_grades_only_to_the_graded_semester(monkeypatch) -> None:
    calls = _patch_api(
        monkeypatch,
        {"BA2201302": {"success": True, "data": {"gpa": 3.54, "semester": 1132, "total_students": 35, "grade_distribution": {"A+": 10, "A": "7", "X": None}}}},
        {"行銷管理": [("BA2201302", "行銷管理", "梁浩怡", 1142), ("BA2201302", "行銷管理", "測試教師1", 1132), ("BA2201301", "行銷管理", "梁浩怡", 1142)]},
    )
    rows, status = gpa.fetch_gpa_history("行銷管理", "key", False)
    assert status == "found"
    assert [(r.semester, r.course_no, r.teacher, r.gpa, r.students) for r in rows] == [
        (1142, "BA2201301", "梁浩怡", None, None),
        (1142, "BA2201302", "梁浩怡", None, None),
        (1132, "BA2201302", "測試教師1", 3.54, 35),
    ]
    assert rows[2].distribution == {"A+": 10, "A": 7}
    assert sorted(calls) == ["BA2201301", "BA2201302", "history:行銷管理"]


def test_gpa_history_reports_unavailable_history(monkeypatch) -> None:
    _patch_api(monkeypatch, {}, None)
    assert gpa.fetch_gpa_history("演算法", "key", False) == (None, "error")
    assert gpa.fetch_gpa_history("演算法", "", False) == (None, "not_enabled")
