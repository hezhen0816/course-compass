from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT_DIR))

from backend.services.typed_planner.apply import dry_run_typed_planner_backfill_package


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Dry-run a typed planner backfill apply from a local package. "
            "This tool does not connect to Supabase and never writes database rows."
        ),
    )
    parser.add_argument("package_dir", type=Path, help="Directory containing backup, preview, reconciliation, and manifest JSON files.")
    parser.add_argument("--output", type=Path, help="Write dry-run report JSON to this path instead of stdout.")
    parser.add_argument("--force", action="store_true", help="Overwrite --output if it already exists.")
    args = parser.parse_args()

    try:
        report = dry_run_typed_planner_backfill_package(args.package_dir)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise SystemExit(f"typed planner apply dry-run failed: {exc}") from exc

    output = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
    if args.output:
        if args.output.exists() and not args.force:
            raise SystemExit(f"typed planner apply dry-run failed: {args.output} already exists; pass --force to overwrite")
        args.output.write_text(output + "\n", encoding="utf-8")
    else:
        sys.stdout.write(output + "\n")


if __name__ == "__main__":
    main()
