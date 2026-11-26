"""Per-client rate limit for routes that proxy the school's systems.

The course-search and TR-room routes fan out to querycourse.ntust.edu.tw. They
need no login (the Web's demo mode and the public search use them), so without
a limit a caller could hammer the school through this host's IP
and get it blocked. Limits are small, in-memory, per client IP, per route
group; the process is single-instance so that is enough.
"""

from __future__ import annotations

import os
import threading
import time
from collections import deque
from collections.abc import Callable

from starlette.requests import Request
from starlette.responses import JSONResponse

# route prefix -> (max requests, window seconds). Overridable by env for ops.
DEFAULT_LIMITS: dict[str, tuple[int, int]] = {
    "/api/courses/search": (int(os.environ.get("RATE_LIMIT_COURSE_SEARCH", "30")), 60),
    "/api/courses/semesters": (int(os.environ.get("RATE_LIMIT_COURSE_SEMESTERS", "30")), 60),
    # Each call can fan out to ~10 myNTUST requests, so keep it well under that API's 120/min.
    "/api/courses/gpa-history": (int(os.environ.get("RATE_LIMIT_GPA_HISTORY", "10")), 60),
    # One solve fans out to one history call per course name plus one grade call per section.
    "/api/planner/solve": (int(os.environ.get("RATE_LIMIT_PLANNER_SOLVE", "6")), 60),
    "/api/tr-rooms/": (int(os.environ.get("RATE_LIMIT_TR_ROOMS", "30")), 60),
}


class SlidingWindowLimiter:
    def __init__(self, limits: dict[str, tuple[int, int]] | None = None, clock: Callable[[], float] = time.monotonic) -> None:
        self.limits = limits if limits is not None else DEFAULT_LIMITS
        self._clock = clock
        self._hits: dict[tuple[str, str], deque[float]] = {}
        self._lock = threading.Lock()

    def group_for(self, path: str) -> str | None:
        for prefix in self.limits:
            if path.startswith(prefix):
                return prefix
        return None

    def check(self, client: str, group: str) -> tuple[bool, int]:
        """Record one hit; return (allowed, seconds until a slot frees)."""
        max_requests, window = self.limits[group]
        now = self._clock()
        with self._lock:
            hits = self._hits.setdefault((client, group), deque())
            while hits and now - hits[0] >= window:
                hits.popleft()
            if len(hits) >= max_requests:
                return False, max(1, int(window - (now - hits[0])) + 1)
            hits.append(now)
            return True, 0


def client_address(request: Request) -> str:
    # A reverse proxy may sit in front; the first X-Forwarded-For entry is the caller.
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def install(app, limiter: SlidingWindowLimiter | None = None) -> SlidingWindowLimiter:
    limiter = limiter or SlidingWindowLimiter()

    @app.middleware("http")
    async def _rate_limit(request: Request, call_next):
        group = limiter.group_for(request.url.path)
        if group is None:
            return await call_next(request)
        allowed, retry_after = limiter.check(client_address(request), group)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={"detail": "查詢太頻繁，請稍後再試。"},
                headers={"Retry-After": str(retry_after)},
            )
        return await call_next(request)

    return limiter
