from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from backend.services import session_context


def test_current_user_context_validates_bearer_token() -> None:
    assert session_context.current_user_context(
        "Bearer access-token",
        lambda token: f"user:{token}",
    ) == ("user:access-token", "access-token")


