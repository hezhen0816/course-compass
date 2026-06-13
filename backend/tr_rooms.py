from __future__ import annotations

try:
    from .integrations.tr_rooms import *  # noqa: F401,F403
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from integrations.tr_rooms import *  # type: ignore  # noqa: F401,F403
