from __future__ import annotations

try:
    from .core.config import *  # noqa: F401,F403
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from core.config import *  # type: ignore  # noqa: F401,F403
