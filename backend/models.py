from __future__ import annotations

try:
    from .schemas.models import *  # noqa: F401,F403
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from schemas.models import *  # type: ignore  # noqa: F401,F403
