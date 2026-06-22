from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any


DEFAULT_BACKEND_URL = "https://course-planner-backend-production.up.railway.app"
REQUIRED_OPENAPI_PATHS = {
    "/api/planner/data",
    "/api/school-credentials",
    "/api/official-selection/a02/sync",
    "/api/official-selection/a02/keep-alive",
    "/api/official-selection/a02/join",
    "/api/official-selection/a02/add-to-waitlist",
    "/api/official-selection/a02/remove",
    "/api/official-selection/a02/reorder",
}


def _fetch_json(url: str) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(url, timeout=20) as response:
            payload = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"{url} returned HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"{url} request failed: {exc.reason}") from exc

    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{url} did not return JSON") from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"{url} returned non-object JSON")
    return data


def verify_backend(base_url: str) -> list[str]:
    base_url = base_url.rstrip("/")
    issues: list[str] = []

    health = _fetch_json(f"{base_url}/health")
    if health.get("ok") is not True:
        issues.append("/health ok is not true")
    capabilities = health.get("capabilities")
    if not isinstance(capabilities, dict):
        issues.append("/health missing capabilities object")
    else:
        if capabilities.get("school_credentials") is not True:
            issues.append("/health missing school_credentials capability")
        if capabilities.get("school_sessions") is not True:
            issues.append("/health missing school_sessions capability")
        if capabilities.get("official_selection") is not True:
            issues.append("/health missing official_selection capability")
        if capabilities.get("typed_planner_read") is not True:
            issues.append("/health missing typed_planner_read capability")

    openapi = _fetch_json(f"{base_url}/openapi.json")
    paths = openapi.get("paths")
    if not isinstance(paths, dict):
        issues.append("/openapi.json missing paths object")
    else:
        missing_paths = sorted(REQUIRED_OPENAPI_PATHS - set(paths))
        for path in missing_paths:
            issues.append(f"/openapi.json missing {path}")

    return issues


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify production backend supports official selection APIs.")
    parser.add_argument("--base-url", default=DEFAULT_BACKEND_URL)
    args = parser.parse_args()

    try:
        issues = verify_backend(args.base_url)
    except RuntimeError as exc:
        print(f"backend verification failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc

    if issues:
        print("backend verification failed:")
        for issue in issues:
            print(f"- {issue}")
        raise SystemExit(1)

    print("backend verification passed")


if __name__ == "__main__":
    main()
