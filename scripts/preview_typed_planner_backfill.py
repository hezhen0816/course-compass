from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_DIR))

from backend.services.typed_planner_backfill import (
    build_typed_planner_preview,
    load_user_data_rows,
    write_typed_planner_backfill_package,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Preview typed planner table rows from an exported public.user_data JSON file. "
            "This tool does not connect to Supabase and never writes database rows."
        ),
    )
    parser.add_argument("input_json", type=Path, help="JSON export containing user_data rows.")
    parser.add_argument("--output", type=Path, help="Write preview JSON to this path instead of stdout.")
    parser.add_argument("--package-dir", type=Path, help="Write a backup, preview, reconciliation, and manifest package.")
    parser.add_argument("--force", action="store_true", help="Overwrite files in --package-dir or --output.")
    parser.add_argument("--counts-only", action="store_true", help="Omit row arrays and print only counts/warnings.")
    args = parser.parse_args()

    if args.output and args.package_dir:
        raise SystemExit("--output cannot be combined with --package-dir")

    try:
        rows = load_user_data_rows(args.input_json)
        if args.package_dir:
            manifest = write_typed_planner_backfill_package(
                rows,
                args.package_dir,
                include_rows=not args.counts_only,
                force=args.force,
            )
            sys.stdout.write(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
            return
        preview = build_typed_planner_preview(rows, include_rows=not args.counts_only)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise SystemExit(f"preview failed: {exc}") from exc

    output = json.dumps(preview, ensure_ascii=False, indent=2, sort_keys=True)
    if args.output:
        if args.output.exists() and not args.force:
            raise SystemExit(f"preview failed: {args.output} already exists; pass --force to overwrite")
        args.output.write_text(output + "\n", encoding="utf-8")
    else:
        sys.stdout.write(output + "\n")


if __name__ == "__main__":
    main()
