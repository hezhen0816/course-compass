from __future__ import annotations

from backend.planner_solver import Candidate, PlanRequest, Requirement, solve


def _cand(rid, code, teacher, slots, terms, gpa=None, credits=3, campus="", risk=0):
    return Candidate(
        id=f"{code}-{teacher}",
        requirement_id=rid,
        course_no=code,
        name=rid,
        teacher=teacher,
        credits=credits,
        slots=tuple(slots),
        offered_terms=tuple(terms),
        gpa=gpa,
        campus=campus,
        risk=risk,
    )


TERMS = ("1152", "1161", "1162")


def test_picks_higher_gpa_section_and_avoids_overlap() -> None:
    req = PlanRequest(
        terms=TERMS,
        requirements=(Requirement("演算法", "演算法", 3), Requirement("資料庫", "資料庫", 3)),
        candidates=(
            _cand("演算法", "CS3001301", "鮑", ["M2", "M3", "M4"], ["1152"], gpa=2.5),
            _cand("演算法", "CS3001302", "王", ["M2", "M3", "M4"], ["1152"], gpa=3.1),
            _cand("資料庫", "CS3010301", "吳", ["M3", "M4", "M5"], ["1152", "1162"], gpa=3.0),
        ),
    )
    result = solve(req)
    assert result.status == "optimal"
    placed = {p.candidate.requirement_id: (p.term, p.candidate.teacher) for p in result.placements}
    assert placed["演算法"] == ("1152", "王")
    # 資料庫 overlaps 演算法 on M3/M4 in 1152, so it moves to 1162.
    assert placed["資料庫"] == ("1162", "吳")
    assert result.unplaced == ()


def test_prerequisite_forces_a_later_term_and_credit_cap_spreads_load() -> None:
    req = PlanRequest(
        terms=TERMS,
        requirements=(Requirement("計組", "計組", 3), Requirement("作業系統", "作業系統", 3), Requirement("演算法", "演算法", 3)),
        candidates=(
            _cand("計組", "CS2006302", "戴", ["R4", "T3", "T4"], TERMS),
            _cand("作業系統", "CS3006301", "鄭", ["W2", "W3", "W4"], TERMS),
            _cand("演算法", "CS3001302", "王", ["M2", "M3", "M4"], TERMS),
        ),
        max_credits={t: 3 for t in TERMS},
        prerequisites=(("計組", "作業系統"),),
    )
    result = solve(req)
    placed = {p.candidate.requirement_id: p.term for p in result.placements}
    assert placed["計組"] < placed["作業系統"]
    assert sorted(result.credits_by_term.values()) == [3, 3, 3]


def test_reports_requirements_with_no_offering_and_keeps_going() -> None:
    req = PlanRequest(
        terms=TERMS,
        requirements=(Requirement("A", "A", 3), Requirement("B", "B", 3)),
        candidates=(_cand("A", "X1", "t", ["M2"], ["1152"]),),
    )
    result = solve(req)
    assert [p.candidate.requirement_id for p in result.placements] == ["A"]
    assert result.unplaced == (("B", "這幾個學期都沒有歷史開課（或被系所限定排除）"),)


def test_cross_campus_adjacent_periods_are_not_stacked_in_one_term() -> None:
    req = PlanRequest(
        terms=("1152",),
        requirements=(Requirement("A", "A", 3), Requirement("B", "B", 3)),
        candidates=(
            _cand("A", "X1", "t", ["W6", "W7", "W8"], ["1152"], campus="華夏"),
            _cand("B", "X2", "u", ["W9", "W10"], ["1152"], campus=""),
        ),
    )
    assert len(solve(req).placements) == 1
    req_no_gap = PlanRequest(**{**req.__dict__, "campus_gap": False})
    assert len(solve(req_no_gap).placements) == 2


def test_balanced_preference_spreads_terms_and_deadline_is_respected() -> None:
    cands = tuple(
        _cand(f"R{i}", f"C{i}", "t", [f"{'MTWRF'[i % 5]}{2 + (i // 5) * 3}"], TERMS)
        for i in range(6)
    )
    reqs = tuple(Requirement(f"R{i}", f"R{i}", 3) for i in range(6))
    balanced = solve(PlanRequest(terms=TERMS, requirements=reqs, candidates=cands, preference="balanced"))
    assert max(balanced.credits_by_term.values()) == 6
    early = solve(PlanRequest(terms=TERMS, requirements=reqs, candidates=cands, deadlines={"R5": "1152"}))
    assert {p.candidate.requirement_id: p.term for p in early.placements}["R5"] == "1152"


def test_unreachable_lower_bounds_are_explained_up_front() -> None:
    req = PlanRequest(
        terms=TERMS,
        requirements=(Requirement("A", "A", 3),),
        candidates=(_cand("A", "X1", "t", ["M2"], TERMS),),
        min_credits={t: 15 for t in TERMS},
    )
    result = solve(req)
    assert result.status == "infeasible" and result.stages == ()
    assert "下限加總 45" in result.unplaced[0][1]


def test_credit_pool_picks_distinct_courses_by_gpa_up_to_the_pool_size() -> None:
    pool = Requirement("fb", "財金選修 6 學分", 3, pool_credits=6)
    cands = (
        Candidate("a1", "fb", "FB1", "投資學", "甲", 3, ("M2", "M3", "M4"), TERMS, gpa=3.9, group="投資學"),
        Candidate("a2", "fb", "FB1b", "投資學", "乙", 3, ("T2", "T3", "T4"), TERMS, gpa=3.2, group="投資學"),
        Candidate("b1", "fb", "FB2", "債券市場", "丙", 3, ("W2", "W3", "W4"), TERMS, gpa=3.5, group="債券市場"),
        Candidate("c1", "fb", "FB3", "保險學", "丁", 3, ("M2", "M3", "M4"), TERMS, gpa=3.7, group="保險學"),
    )
    result = solve(PlanRequest(terms=TERMS, requirements=(pool,), candidates=cands))
    chosen = sorted((p.candidate.name, p.candidate.teacher) for p in result.placements)
    # 6 credits = two different courses; 投資學 甲 (3.9) + 保險學 (3.7) beat 債券市場 (3.5); 甲/乙 never both.
    assert chosen == [("保險學", "丁"), ("投資學", "甲")]
    assert result.unplaced == ()
    assert sum(result.credits_by_term.values()) == 6
