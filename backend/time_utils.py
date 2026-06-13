from __future__ import annotations

try:
    from .core.time_utils import *  # noqa: F401,F403
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from core.time_utils import *  # type: ignore  # noqa: F401,F403
