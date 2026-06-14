from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_DIR))

from backend.services.typed_planner_backfill import (
    build_typed_planner_apply_plan,
    load_typed_planner_backfill_package,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Build a no-write typed planner apply plan from a backfill package. "
            "This tool does not connect to Supabase and never writes database rows."
        ),
    )
    parser.add_argument("package_dir", type=Path, help="Directory containing backup, preview, reconciliation, and manifest JSON files.")
    parser.add_argument("--output", type=Path, help="Write apply plan JSON to this path instead of stdout.")
    parser.add_argument("--force", action="store_true", help="Overwrite --output if it already exists.")
    args = parser.parse_args()

    try:
        package = load_typed_planner_backfill_package(args.package_dir)
        plan = build_typed_planner_apply_plan(package)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise SystemExit(f"apply plan failed: {exc}") from exc

    output = json.dumps(plan, ensure_ascii=False, indent=2, sort_keys=True)
    if args.output:
        if args.output.exists() and not args.force:
            raise SystemExit(f"apply plan failed: {args.output} already exists; pass --force to overwrite")
        args.output.write_text(output + "\n", encoding="utf-8")
    else:
        sys.stdout.write(output + "\n")


if __name__ == "__main__":
    main()
