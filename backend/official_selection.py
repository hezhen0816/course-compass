from __future__ import annotations

try:
    from .integrations import official_selection as _impl
    from .integrations.official_selection import *  # noqa: F401,F403
except ImportError:  # pragma: no cover - supports PYTHONPATH=backend imports.
    from integrations import official_selection as _impl  # type: ignore
    from integrations.official_selection import *  # type: ignore  # noqa: F401,F403

_arraydata_form_rows = _impl._arraydata_form_rows
_parse_action_response_notices = _impl._parse_action_response_notices
_schedule_rows_from_slots = _impl._schedule_rows_from_slots
