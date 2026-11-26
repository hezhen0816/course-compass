from __future__ import annotations

import requests

import backend.gpa as gpa
import backend.myntust_cache as cache


class _Response:
    def __init__(self, payload=None, status_code=200):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _configure(monkeypatch) -> None:
    monkeypatch.setattr(cache, "SUPABASE_URL", "https://database.example.org")
    monkeypatch.setattr(cache, "SUPABASE_SERVICE_ROLE_KEY", "service-key")


def test_loads_parse_batched_grade_and_history_rows(monkeypatch) -> None:
    _configure(monkeypatch)
    calls = []

    def fake_post(url, headers, json, timeout):
        calls.append((url, headers, json, timeout))
        if json["p_kind"] == "grade":
            return _Response(
                [
                    {
                        "course_no": "CS1",
                        "status": "found",
                        "gpa": 3.5,
                        "semester": 1142,
                        "students": 40,
                        "distribution": {"A": 10},
                    }
                ]
            )
        return _Response(
            [
                {
                    "course_name": "演算法",
                    "rows": [
                        {
                            "course_no": "CS1",
                            "course_name": "演算法",
                            "lecturer": "王老師",
                            "semester": 1142,
                            "node": "M2,M3,M4",
                            "credit": 3,
                            "classroom": "TR-409",
                        }
                    ],
                }
            ]
        )

    monkeypatch.setattr(cache.requests, "post", fake_post)

    assert cache.load_grades(["cs1", "CS1"]) == {
        "CS1": gpa.GradeRecord(3.5, "found", 1142, 40, {"A": 10})
    }
    assert cache.load_histories(["演 算法", "演算法"]) == {
        "演算法": [gpa.HistoryRow("CS1", "演算法", "王老師", 1142, "M2,M3,M4", 3, "TR-409")]
    }
    assert len(calls) == 2
    assert calls[0][0].endswith("/rest/v1/rpc/get_myntust_cache")
    assert calls[0][2] == {"p_kind": "grade", "p_keys": ["CS1"]}
    assert calls[1][2] == {"p_kind": "history", "p_keys": ["演算法"]}
    assert calls[0][1]["Authorization"] == "Bearer service-key"


def test_saves_use_the_expected_rpc_payload(monkeypatch) -> None:
    _configure(monkeypatch)
    calls = []

    def fake_post(url, headers, json, timeout):
        calls.append((url, json))
        return _Response(None)

    monkeypatch.setattr(cache.requests, "post", fake_post)
    cache.save_grade("cs1", gpa.GradeRecord(3.5, "found", 1142, 40, {"A": 10}))
    cache.save_grade("no-data", gpa.GradeRecord(None, "no_data"))
    cache.save_grade("error", gpa.GradeRecord(None, "error"))
    cache.save_history(
        "演 算法",
        [gpa.HistoryRow("CS1", "演算法", "王老師", 1142, "M2", 3, "TR-409")],
    )

    assert calls == [
        (
            "https://database.example.org/rest/v1/rpc/upsert_myntust_grade",
            {
                "p_course_no": "CS1",
                "p_status": "found",
                "p_gpa": 3.5,
                "p_semester": 1142,
                "p_students": 40,
                "p_distribution": {"A": 10},
            },
        ),
        (
            "https://database.example.org/rest/v1/rpc/upsert_myntust_grade",
            {
                "p_course_no": "NO-DATA",
                "p_status": "no_data",
                "p_gpa": None,
                "p_semester": None,
                "p_students": None,
                "p_distribution": None,
            },
        ),
        (
            "https://database.example.org/rest/v1/rpc/upsert_myntust_history",
            {
                "p_course_name": "演算法",
                "p_rows": [
                    {
                        "course_no": "CS1",
                        "course_name": "演算法",
                        "lecturer": "王老師",
                        "semester": 1142,
                        "node": "M2",
                        "credit": 3,
                        "classroom": "TR-409",
                    }
                ],
            },
        ),
    ]


def test_network_errors_are_empty_or_noop(monkeypatch) -> None:
    _configure(monkeypatch)

    def fail(*args, **kwargs):
        raise requests.RequestException("offline")

    monkeypatch.setattr(cache.requests, "post", fail)
    assert cache.load_grades(["CS1"]) == {}
    cache.save_grade("CS1", gpa.GradeRecord(3.5, "found"))
    cache.save_history("演算法", [])


def test_unconfigured_cache_makes_no_http_call(monkeypatch) -> None:
    monkeypatch.setattr(cache, "SUPABASE_URL", "")
    monkeypatch.setattr(cache, "SUPABASE_SERVICE_ROLE_KEY", "")

    def fail(*args, **kwargs):
        raise AssertionError("unconfigured cache must not make HTTP calls")

    monkeypatch.setattr(cache.requests, "post", fail)
    assert cache.load_grades(["CS1"]) == {}
    assert cache.load_histories(["演算法"]) == {}
    cache.save_grade("CS1", gpa.GradeRecord(3.5, "found"))
    cache.save_history("演算法", [])
