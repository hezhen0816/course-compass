from __future__ import annotations

from fastapi.testclient import TestClient

import backend.gpa as gpa
import backend.api.planner_solve as planner_solve
import backend.planner_candidates as planner_candidates
from backend import app as backend_app
from backend.planner_candidates import RequirementSpec, build_candidates, offered_in


class _Resp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}
        self.headers = {}

    def json(self):
        return self._payload


def _history_payload(rows):
    return {
        "success": True,
        "data": [
            {"course_no": c, "course_name": n, "lecturer": t, "semester": s, "credit": 1 if c.startswith("BAG") else 3, "node": node, "classroom_no": room}
            for c, n, t, s, node, room in rows
        ],
        "pagination": {"has_next": False},
    }


def _patch(monkeypatch, histories, grades, catalog_contents=None, catalog_failure=False):
    def fake_get(url, headers, timeout, verify, params=None):
        if url == gpa.COURSE_HISTORY_API_URL:
            return _Resp(payload=_history_payload(histories.get(params["keyword"], [])))
        code = url.rsplit("/", 1)[-1]
        if code in grades:
            return _Resp(payload={"success": True, "data": grades[code]})
        return _Resp(status_code=404, payload={"success": False})

    monkeypatch.setattr(gpa.requests, "get", fake_get)
    catalog_calls = []

    def fake_catalog(semester, *, course_no="", verify_ssl=True, include_cross_school=False):
        catalog_calls.append((semester, course_no, include_cross_school))
        if catalog_failure:
            raise RuntimeError("catalog unavailable")
        return [
            {"CourseNo": code, "Contents": contents}
            for code, contents in (catalog_contents or {}).items()
            if code[:2] == course_no
        ]

    monkeypatch.setattr(planner_solve, "fetch_query_courses_filtered", fake_catalog)
    return catalog_calls


def setup_function() -> None:
    gpa.clear_cache()
    planner_candidates.clear_catalog_cache()


def test_offered_in_matches_half_year_within_lookback() -> None:
    assert offered_in(["1152", "1161", "1162"], [1142, 1132], 116) == ("1152", "1162")
    assert offered_in(["1152", "1161"], [1101], 116) == ()  # too old


def test_build_candidates_groups_by_code_and_teacher_and_attaches_own_gpa(monkeypatch) -> None:
    _patch(
        monkeypatch,
        {
            "演算法": [
                ("CS3001302", "演算法", "王紹睿", 1142, "M4,M2,M3", "TR-409"),
                ("CS3001302", "演算法", "王紹睿", 1132, "M2,M3,M4", ""),
                ("CS3001301", "演算法", "鮑興國", 1142, "T2,W3,W4", ""),
                ("3T1218701", "演算法", "蔡益坤", 1151, "T7,T8,T9", ""),
                ("MI3103701", "演算法", "楊傳凱", 1142, "W2,W3,W4", "華夏D507"),
                ("BAG005301", "演算法", "微課程", 1142, "W5", ""),
            ]
        },
        {"CS3001302": {"gpa": 3.1, "semester": 1142, "total_students": 50}},
    )
    build = build_candidates(
        [RequirementSpec("algo", "演算法", 3, ("演算法",), department_prefixes=("CS",))],
        ["1152", "1161"],
        "key",
        False,
    )
    assert build.status == "found"
    by_code = {c.course_no: c for c in build.candidates}
    assert set(by_code) == {"CS3001302", "CS3001301"}  # 3T (cross-school), MI (prefix), 1-credit BAG excluded
    assert by_code["CS3001302"].offered_terms == ("1152",)
    assert by_code["CS3001302"].gpa == 3.1 and by_code["CS3001302"].risk == 0
    assert by_code["CS3001301"].gpa is None and by_code["CS3001301"].risk == 1
    assert by_code["CS3001302"].slots == ("M2", "M3", "M4")


def test_solve_endpoint_requires_gpa_key_and_returns_placements(monkeypatch) -> None:
    client = TestClient(backend_app.app)
    body = {
        "terms": ["1152"],
        "requirements": [{"id": "algo", "title": "演算法", "credits": 3}],
        "preferred_prefixes": ["CS"],
    }
    monkeypatch.setattr(backend_app, "get_gpa_api_key_secret", lambda user_id: "")
    assert client.post("/api/planner/solve", json=body).json()["status"] == "not_enabled"

    monkeypatch.setattr(backend_app, "get_gpa_api_key_secret", lambda user_id: "key")
    catalog_calls = _patch(
        monkeypatch,
        {
            "演算法": [
                ("CS3001302", "演算法", "王紹睿", 1142, "M2,M3,M4", ""),
                ("CS3001301", "演算法", "鮑興國", 1142, "T2,T3,T4", ""),
            ]
        },
        {"CS3001302": {"gpa": 3.1, "semester": 1142, "total_students": 50}},
        catalog_contents={
            "CS3001302": "限管理學士班學生選修",
            "CS3001301": "授權碼方式選課，欲選課者請洽授課老師",
        },
    )
    response = client.post("/api/planner/solve", json=body)
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "found" and payload["solver_status"] == "optimal"
    assert [(p["term"], p["course_no"]) for p in payload["placements"]] == [("1152", "CS3001301")]
    assert payload["credits_by_term"] == {"1152": 3}
    assert payload["candidates"][0]["offered_terms"] == ["1152"]
    assert {candidate["course_no"] for candidate in payload["candidates"]} == {"CS3001301"}
    assert payload["candidates"][0]["eligibility"] == "signature"
    assert payload["candidates"][0]["risk"] == 3
    assert payload["placements"][0]["contents"] == "授權碼方式選課，欲選課者請洽授課老師"
    assert catalog_calls == [("1142", "CS", False)]


def test_solve_endpoint_catalog_failure_keeps_candidates_unknown(monkeypatch) -> None:
    client = TestClient(backend_app.app)
    body = {
        "terms": ["1152"],
        "requirements": [{"id": "algo", "title": "演算法", "credits": 3}],
        "preferred_prefixes": ["CS"],
    }
    monkeypatch.setattr(backend_app, "get_gpa_api_key_secret", lambda user_id: "key")
    catalog_calls = _patch(
        monkeypatch,
        {"演算法": [("CS3001302", "演算法", "王紹睿", 1142, "M2,M3,M4", "")]},
        {"CS3001302": {"gpa": 3.1, "semester": 1142, "total_students": 50}},
        catalog_failure=True,
    )

    response = client.post("/api/planner/solve", json=body)
    assert response.status_code == 200
    payload = response.json()
    assert [(p["term"], p["course_no"]) for p in payload["placements"]] == [("1152", "CS3001302")]
    assert payload["candidates"][0]["eligibility"] == "unknown"
    assert payload["candidates"][0]["contents"] == ""
    assert "__catalog__" in payload["notes"]
    assert "1142/CS" in payload["notes"]["__catalog__"]
    assert catalog_calls == [("1142", "CS", False)]
