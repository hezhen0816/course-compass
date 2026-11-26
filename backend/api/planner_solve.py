from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, Header, HTTPException

try:
    from ..config import DEFAULT_VERIFY_SSL
    from ..models import PlannerCandidatePayload, PlannerPlacementPayload, PlannerSolveRequest, PlannerSolveResponse
    from ..planner_candidates import RequirementSpec, build_candidates, candidate_to_dict
    from ..planner_solver import PlanRequest, solve
    from ..tr_rooms import fetch_query_courses_filtered
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from config import DEFAULT_VERIFY_SSL
    from models import PlannerCandidatePayload, PlannerPlacementPayload, PlannerSolveRequest, PlannerSolveResponse
    from planner_candidates import RequirementSpec, build_candidates, candidate_to_dict
    from planner_solver import PlanRequest, solve
    from tr_rooms import fetch_query_courses_filtered


GpaApiKeyReader = Callable[[str | None], str]
MAX_REQUIREMENTS = 40
MAX_TERMS = 8


def create_planner_solve_router(read_gpa_api_key: GpaApiKeyReader) -> APIRouter:
    router = APIRouter(prefix="/api/planner", tags=["planner"])

    @router.post("/solve", response_model=PlannerSolveResponse)
    def solve_plan(
        request: PlannerSolveRequest,
        authorization: str | None = Header(default=None),
    ) -> PlannerSolveResponse:
        """多學期排課：待修需求 → myNTUST 歷史班別 → CP-SAT 排進未來學期。需要登入且啟用 GPA 密鑰。"""
        if len(request.requirements) > MAX_REQUIREMENTS or len(request.terms) > MAX_TERMS:
            raise HTTPException(status_code=400, detail=f"一次最多 {MAX_REQUIREMENTS} 個需求、{MAX_TERMS} 個學期。")
        api_key = read_gpa_api_key(authorization)
        if not api_key:
            return PlannerSolveResponse(status="not_enabled", solver_status="skipped")

        specs = [
            RequirementSpec(
                id=r.id,
                title=r.title,
                credits=r.credits,
                course_names=tuple(n for n in r.course_names if n.strip()) or (r.title,),
                required=r.required,
                department_prefixes=tuple(p.strip().upper() for p in r.department_prefixes if p.strip()),
                pool_credits=r.pool_credits,
            )
            for r in request.requirements
        ]
        build = build_candidates(
            specs=specs,
            plan_terms=request.terms,
            api_key=api_key,
            verify_ssl=DEFAULT_VERIFY_SSL,
            include_cross_school=request.include_cross_school,
            preferred_prefixes=tuple(p.strip().upper() for p in request.preferred_prefixes if p.strip()),
            fetch_catalog=lambda semester, prefix: fetch_query_courses_filtered(
                semester,
                course_no=prefix,
                verify_ssl=DEFAULT_VERIFY_SSL,
                include_cross_school=request.include_cross_school,
            ),
        )
        result = solve(
            PlanRequest(
                terms=tuple(request.terms),
                requirements=tuple(build.requirements),
                candidates=tuple(build.candidates),
                min_credits=request.min_credits,
                max_credits=request.max_credits,
                reserved_credits=request.reserved_credits,
                prerequisites=tuple((pair[0], pair[1]) for pair in request.prerequisites if len(pair) == 2),
                deadlines=request.deadlines,
                campus_gap=request.campus_gap,
                preference=request.preference if request.preference in {"gpa", "balanced"} else "gpa",
            )
        )
        payload = result.as_dict()
        return PlannerSolveResponse(
            status=build.status,
            solver_status=payload["status"],
            placements=[PlannerPlacementPayload(**p) for p in payload["placements"]],
            unplaced=payload["unplaced"],
            notes=build.notes,
            credits_by_term=payload["credits_by_term"],
            stages=payload["stages"],
            candidates=[PlannerCandidatePayload(**candidate_to_dict(c)) for c in build.candidates],
        )

    return router
