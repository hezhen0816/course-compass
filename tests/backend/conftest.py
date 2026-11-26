from __future__ import annotations

import os

import pytest

from backend import credentials

os.environ.setdefault("TR_COURSE_PREWARM", "0")


@pytest.fixture(autouse=True)
def _clear_user_id_cache():
    credentials.clear_user_id_cache()
    yield
    credentials.clear_user_id_cache()
