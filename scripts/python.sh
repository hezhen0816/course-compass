#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON_BIN:-}"

if [[ -z "$PYTHON_BIN" ]]; then
  if [[ -x ".venv/bin/python" ]]; then
    PYTHON_BIN=".venv/bin/python"
  elif [[ -x "$HOME/.venvs/course_planner/bin/python" ]]; then
    PYTHON_BIN="$HOME/.venvs/course_planner/bin/python"
  else
    PYTHON_BIN="python3"
  fi
fi

if [[ "${1:-}" == "--print" ]]; then
  echo "$PYTHON_BIN"
  exit 0
fi

exec "$PYTHON_BIN" "$@"
