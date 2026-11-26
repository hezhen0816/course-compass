from __future__ import annotations

import pytest

from backend.course_restrictions import evaluate_eligibility, parse_course_restrictions


@pytest.mark.parametrize(
    ("course_no", "contents", "identity", "phase", "expected"),
    [
        (
            "MB2100303",
            "限四管理一.四工管一..四資管一學號除3餘2者修讀／PBL課程／EMI課程／英語授課／遴選不開放選修",
            {"CS", "BA", "FB"},
            "addDrop",
            "blocked",
        ),
        (
            "BA4711302",
            "四企一雙號／遴選不開放選修／限55人",
            {"BA"},
            "addDrop",
            "open",
        ),
        (
            "FB2100701",
            "財金學位學程開放全校大二大三大四選修",
            {"CS"},
            "addDrop",
            "open",
        ),
        (
            "IM4513701",
            "初選限本校資管系學生選課，加退選開放外系選課",
            {"CS"},
            "addDrop",
            "open",
        ),
        (
            "IM4513701",
            "初選限本校資管系學生選課，加退選開放外系選課",
            {"CS"},
            "preregistration",
            "blocked",
        ),
        (
            "IM4513701",
            "授權碼方式選課，欲選課者請洽授課老師",
            {"CS"},
            "addDrop",
            "signature",
        ),
        (
            "MB2001301",
            "限管理學士班學生選修",
            {"CS"},
            "addDrop",
            "blocked",
        ),
        (
            "CS3001302",
            "限管理學士班學生選修",
            set(),
            "addDrop",
            "unknown",
        ),
        (
            "CS3001302",
            "限在職專班",
            {"CS"},
            "addDrop",
            "blocked",
        ),
    ],
)
def test_evaluate_eligibility_matches_course_restriction_smoke_cases(
    course_no: str,
    contents: str,
    identity: set[str],
    phase: str,
    expected: str,
) -> None:
    assert evaluate_eligibility(course_no, contents, identity, phase).level == expected


def test_evaluate_eligibility_preserves_ts_reason_strings() -> None:
    blocked = evaluate_eligibility("MB2001301", "限管理學士班學生選修", {"CS"}, "addDrop")
    assert blocked.label == "資格不符"
    assert blocked.reasons == ["備註「限管理學士班學生選修」，你的主修／雙主修／輔系都不在內。"]

    signature = evaluate_eligibility("IM4513701", "授權碼方式選課，欲選課者請洽授課老師", {"CS"}, "addDrop")
    assert signature.label == "需加簽"
    assert signature.reasons == ["要向授課老師取得授權碼。"]


def test_parse_course_restrictions_splits_and_deduplicates_like_ts() -> None:
    tags = parse_course_restrictions("限管理學士班學生選修／限管理學士班學生選修／EMI課程／PBL課程")
    assert [(tag.kind, tag.label, tag.raw) for tag in tags] == [
        ("eligibility", "限管理學士班", "限管理學士班學生選修"),
        ("language", "EMI 英語授課", "EMI課程"),
        ("format", "PBL", "PBL課程"),
    ]
