from __future__ import annotations

try:
    from .integrations.history import *  # noqa: F401,F403
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from integrations.history import *  # type: ignore  # noqa: F401,F403
