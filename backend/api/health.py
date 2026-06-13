from __future__ import annotations

from typing import Any

from fastapi import APIRouter

try:
    from ..config import SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
    from ..time_utils import now
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from config import SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
    from time_utils import now


def create_health_router(api_version: str, capabilities: dict[str, Any]) -> APIRouter:
    router = APIRouter()

    @router.get("/health")
    def healthcheck() -> dict[str, Any]:
        return {
            "ok": True,
            "version": api_version,
            "supabase_configured": bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY),
            "capabilities": capabilities,
            "timestamp": now().isoformat(),
        }

    return router
