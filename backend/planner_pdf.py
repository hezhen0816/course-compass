from __future__ import annotations

try:
    from .services.planner_pdf import *  # noqa: F401,F403
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from services.planner_pdf import *  # type: ignore  # noqa: F401,F403
