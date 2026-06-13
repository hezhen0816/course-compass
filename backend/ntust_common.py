from __future__ import annotations

try:
    from .integrations.ntust_common import *  # noqa: F401,F403
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from integrations.ntust_common import *  # type: ignore  # noqa: F401,F403
