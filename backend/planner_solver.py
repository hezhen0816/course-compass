"""Multi-semester course placement with CP-SAT.

Given the requirements a student still owes, the sections that have historically
been offered for each of them (with the teacher's GPA where known) and a list of
future terms with credit bounds, pick one section per requirement and a term for
it so that nothing overlaps, prerequisites come first, and — in this order — as
many requirements as possible are placed, the summed GPA is as high as possible,
the risk score is as low as possible, and heavy terms are avoided.

This module is pure: no I/O, no school API. `planner_candidates.py` builds the
inputs from myNTUST history; `api/planner.py` exposes it.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ortools.sat.python import cp_model


SOLVE_TIME_LIMIT_SECONDS = 10.0


@dataclass(frozen=True)
class Candidate:
    """One section that could satisfy one requirement."""

    id: str
    requirement_id: str
    course_no: str
    name: str
    teacher: str
    credits: int
    slots: tuple[str, ...]  # e.g. ("M2", "M3", "M4"); empty = time unknown
    offered_terms: tuple[str, ...]  # plan terms this section can be placed in
    gpa: float | None = None
    students: int | None = None
    campus: str = ""  # "" = main campus
    risk: int = 0  # higher = harder to actually get into
    source_semester: str = ""
    # Course identity inside a credit pool (normalised course name): one section per course.
    group: str = ""
    contents: str = ""
    eligibility: str = "unknown"


@dataclass(frozen=True)
class Requirement:
    id: str
    title: str
    credits: int
    required: bool = True
    # A credit pool: take sections from different courses until pool_credits is reached.
    pool_credits: int | None = None

    @property
    def is_pool(self) -> bool:
        return self.pool_credits is not None and self.pool_credits > 0


@dataclass(frozen=True)
class PlanRequest:
    terms: tuple[str, ...]
    requirements: tuple[Requirement, ...]
    candidates: tuple[Candidate, ...]
    min_credits: dict[str, int] = field(default_factory=dict)
    max_credits: dict[str, int] = field(default_factory=dict)
    # Credits already committed in a term (e.g. capstone), counted toward the bounds.
    reserved_credits: dict[str, int] = field(default_factory=dict)
    # (before_requirement_id, after_requirement_id): after must land in a strictly later term.
    prerequisites: tuple[tuple[str, str], ...] = ()
    # requirement_id -> last term it may be placed in.
    deadlines: dict[str, str] = field(default_factory=dict)
    # Leave one free period between classes on different campuses the same day.
    campus_gap: bool = True
    preference: str = "gpa"  # "gpa" | "balanced"


@dataclass(frozen=True)
class Placement:
    term: str
    candidate: Candidate


@dataclass(frozen=True)
class PlanResult:
    status: str  # optimal / feasible / infeasible / empty
    placements: tuple[Placement, ...]
    unplaced: tuple[tuple[str, str], ...]  # (requirement_id, reason)
    stages: tuple[dict[str, Any], ...]
    credits_by_term: dict[str, int]

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "placements": [
                {"term": p.term, **_candidate_fields(p.candidate)} for p in self.placements
            ],
            "unplaced": [{"requirement_id": rid, "reason": reason} for rid, reason in self.unplaced],
            "stages": list(self.stages),
            "credits_by_term": dict(self.credits_by_term),
        }


def _candidate_fields(c: Candidate) -> dict[str, Any]:
    return {
        "candidate_id": c.id,
        "requirement_id": c.requirement_id,
        "course_no": c.course_no,
        "name": c.name,
        "teacher": c.teacher,
        "credits": c.credits,
        "slots": list(c.slots),
        "gpa": c.gpa,
        "students": c.students,
        "campus": c.campus,
        "risk": c.risk,
        "source_semester": c.source_semester,
        "contents": c.contents,
        "eligibility": c.eligibility,
    }


# ---------------------------------------------------------------------------
# Time helpers

_PERIOD_ORDER = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "A", "B", "C", "D"]


def _slot_parts(slot: str) -> tuple[str, int] | None:
    slot = slot.strip().upper()
    if len(slot) < 2:
        return None
    day, period = slot[0], slot[1:]
    if period not in _PERIOD_ORDER:
        return None
    return day, _PERIOD_ORDER.index(period)


def _adjacent_across_campus(a: Candidate, b: Candidate) -> bool:
    """True when a and b sit on different campuses and have back-to-back periods the same day."""
    if a.campus == b.campus:
        return False
    parts_a = [p for p in (_slot_parts(s) for s in a.slots) if p]
    parts_b = [p for p in (_slot_parts(s) for s in b.slots) if p]
    for day_a, idx_a in parts_a:
        for day_b, idx_b in parts_b:
            if day_a == day_b and abs(idx_a - idx_b) == 1:
                return True
    return False


def _overlaps(a: Candidate, b: Candidate) -> bool:
    return bool(set(s.upper() for s in a.slots) & set(s.upper() for s in b.slots))


# ---------------------------------------------------------------------------
# Solver


def solve(request: PlanRequest) -> PlanResult:
    terms = list(request.terms)
    if not terms or not request.requirements:
        return PlanResult("empty", (), tuple((r.id, "沒有可排的學期") for r in request.requirements), (), {})

    term_index = {term: i for i, term in enumerate(terms)}
    by_requirement: dict[str, list[Candidate]] = {r.id: [] for r in request.requirements}
    for cand in request.candidates:
        if cand.requirement_id in by_requirement and cand.offered_terms:
            by_requirement[cand.requirement_id].append(cand)

    unplaced: list[tuple[str, str]] = []
    active_reqs = [r for r in request.requirements if by_requirement[r.id]]
    for r in request.requirements:
        if not by_requirement[r.id]:
            unplaced.append((r.id, "這幾個學期都沒有歷史開課（或被系所限定排除）"))
    if not active_reqs:
        return PlanResult("infeasible", (), tuple(unplaced), (), {})

    # Cheap sanity check before the solver: lower bounds that no combination can reach
    # would otherwise come back as a bare "infeasible" for every requirement.
    total_available = sum((r.pool_credits if r.is_pool else r.credits) for r in active_reqs) + sum(
        request.reserved_credits.get(t, 0) for t in terms
    )
    total_min = sum(request.min_credits.get(t, 0) for t in terms)
    if total_min > total_available:
        reason = f"各學期學分下限加總 {total_min}，超過待排學分 {total_available}；把下限調低再排"
        return PlanResult("infeasible", (), tuple(unplaced + [(r.id, reason) for r in active_reqs]), (), {})

    model = cp_model.CpModel()
    # x[(cand.id, term)] = this section placed in this term
    x: dict[tuple[str, str], cp_model.IntVar] = {}
    placed: dict[str, cp_model.IntVar] = {}
    term_of: dict[str, cp_model.IntVar] = {}
    for r in active_reqs:
        vars_for_req = []
        for cand in by_requirement[r.id]:
            for term in cand.offered_terms:
                if term not in term_index:
                    continue
                v = model.NewBoolVar(f"x_{cand.id}_{term}")
                x[(cand.id, term)] = v
                vars_for_req.append(v)
        placed[r.id] = model.NewBoolVar(f"placed_{r.id}")
        term_of[r.id] = model.NewIntVar(0, len(terms) - 1, f"term_{r.id}")
        if r.is_pool:
            # One section per course, total credits exactly the pool size (or nothing).
            by_group: dict[str, list[cp_model.IntVar]] = {}
            for cand in by_requirement[r.id]:
                for term in cand.offered_terms:
                    v = x.get((cand.id, term))
                    if v is not None:
                        by_group.setdefault(cand.group or cand.course_no, []).append(v)
            for group_vars in by_group.values():
                model.Add(sum(group_vars) <= 1)
            taken = sum(
                cand.credits * x[(cand.id, term)]
                for cand in by_requirement[r.id]
                for term in cand.offered_terms
                if (cand.id, term) in x
            )
            model.Add(taken == (r.pool_credits or 0)).OnlyEnforceIf(placed[r.id])
            model.Add(taken == 0).OnlyEnforceIf(placed[r.id].Not())
            continue
        model.Add(sum(vars_for_req) == placed[r.id])
        # term index when placed; when not placed it is unconstrained but never read.
        for cand in by_requirement[r.id]:
            for term in cand.offered_terms:
                v = x.get((cand.id, term))
                if v is not None:
                    model.Add(term_of[r.id] == term_index[term]).OnlyEnforceIf(v)

    # Credits per term
    credits_expr: dict[str, Any] = {}
    for term in terms:
        expr = sum(
            cand.credits * x[(cand.id, term)]
            for r in active_reqs
            for cand in by_requirement[r.id]
            if (cand.id, term) in x
        )
        credits_expr[term] = expr
        reserved = request.reserved_credits.get(term, 0)
        if term in request.max_credits:
            model.Add(expr + reserved <= request.max_credits[term])
        if term in request.min_credits:
            model.Add(expr + reserved >= request.min_credits[term])

    # No overlapping sections in the same term; campus gap
    all_cands = [cand for r in active_reqs for cand in by_requirement[r.id]]
    pool_ids = {r.id for r in active_reqs if r.is_pool}
    for i, a in enumerate(all_cands):
        for b in all_cands[i + 1 :]:
            # Alternatives of one course requirement never coexist; pool members can, so check them.
            if a.requirement_id == b.requirement_id and a.requirement_id not in pool_ids:
                continue
            if a.requirement_id == b.requirement_id and (a.group or a.course_no) == (b.group or b.course_no):
                continue
            conflict = _overlaps(a, b) or (request.campus_gap and _adjacent_across_campus(a, b))
            if not conflict:
                continue
            for term in terms:
                va, vb = x.get((a.id, term)), x.get((b.id, term))
                if va is not None and vb is not None:
                    model.AddBoolOr([va.Not(), vb.Not()])

    # Prerequisites and deadlines
    active_ids = {r.id for r in active_reqs}
    for before, after in request.prerequisites:
        if before in active_ids and after in active_ids and before not in pool_ids and after not in pool_ids:
            model.Add(term_of[after] > term_of[before]).OnlyEnforceIf([placed[before], placed[after]])
            # An "after" placed while "before" is not placed at all makes no sense.
            model.AddImplication(placed[after], placed[before])
    for rid, last_term in request.deadlines.items():
        if rid in active_ids and rid not in pool_ids and last_term in term_index:
            model.Add(term_of[rid] <= term_index[last_term]).OnlyEnforceIf(placed[rid])

    # Lexicographic objectives, solved as successive stages.
    stages: list[dict[str, Any]] = []
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = SOLVE_TIME_LIMIT_SECONDS
    solver.parameters.num_workers = 4

    def run_stage(name: str, objective: Any, maximize: bool) -> bool:
        if maximize:
            model.Maximize(objective)
        else:
            model.Minimize(objective)
        status = solver.Solve(model)
        ok = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        stages.append(
            {"stage": name, "status": solver.StatusName(status), "objective": solver.ObjectiveValue() if ok else None}
        )
        if ok:
            value = round(solver.ObjectiveValue())
            model.Add(objective >= value) if maximize else model.Add(objective <= value)
        return ok

    # 1. place as many required requirements as possible (optional ones count less)
    placed_score = sum((10 if r.required else 1) * placed[r.id] for r in active_reqs)
    if not run_stage("placed", placed_score, maximize=True):
        return PlanResult(
            "infeasible",
            (),
            tuple(unplaced + [(r.id, "找不到同時滿足學分上下限、先修與不衝堂的排法；放寬上下限或減少需求") for r in active_reqs]),
            tuple(stages),
            {},
        )

    # 2. GPA, weighted by credits; sections without GPA count 0 so known-good teachers win
    gpa_score = sum(
        int(round((cand.gpa or 0) * 100)) * cand.credits * x[(cand.id, term)]
        for r in active_reqs
        for cand in by_requirement[r.id]
        for term in cand.offered_terms
        if (cand.id, term) in x
    )
    run_stage("gpa", gpa_score, maximize=True)

    # 3. risk
    risk_score = sum(
        cand.risk * x[(cand.id, term)]
        for r in active_reqs
        for cand in by_requirement[r.id]
        for term in cand.offered_terms
        if (cand.id, term) in x
    )
    run_stage("risk", risk_score, maximize=False)

    # 4. balance: keep the heaviest term light ("balanced"), or front-load ("gpa" default: earliest terms)
    if request.preference == "balanced":
        heaviest = model.NewIntVar(0, 60, "heaviest")
        for term in terms:
            model.Add(heaviest >= credits_expr[term] + request.reserved_credits.get(term, 0))
        run_stage("balance", heaviest, maximize=False)
    else:
        lateness = sum(term_of[r.id] for r in active_reqs if not r.is_pool) + sum(
            term_index[term] * x[(cand.id, term)]
            for r in active_reqs
            if r.is_pool
            for cand in by_requirement[r.id]
            for term in cand.offered_terms
            if (cand.id, term) in x
        )
        run_stage("earliest", lateness, maximize=False)

    placements: list[Placement] = []
    credits_by_term = {term: request.reserved_credits.get(term, 0) for term in terms}
    for r in active_reqs:
        if not solver.Value(placed[r.id]):
            unplaced.append((r.id, "塞不進去：時段衝突或學分上限" if not r.is_pool else f"湊不滿 {r.pool_credits} 學分：候選課衝堂或學分上限"))
            continue
        for cand in by_requirement[r.id]:
            for term in cand.offered_terms:
                v = x.get((cand.id, term))
                if v is not None and solver.Value(v):
                    placements.append(Placement(term, cand))
                    credits_by_term[term] += cand.credits
    placements.sort(key=lambda p: (term_index[p.term], p.candidate.name))
    status = "optimal" if all(s["status"] == "OPTIMAL" for s in stages) else "feasible"
    return PlanResult(status, tuple(placements), tuple(unplaced), tuple(stages), credits_by_term)
