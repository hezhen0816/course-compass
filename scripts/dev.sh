#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BACKEND_PID=""
WEB_PID=""
PYTHON_BIN="$(bash scripts/python.sh --print)"

cleanup() {
  if [[ -n "$WEB_PID" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

if [[ ! -f ".env" ]]; then
  echo "找不到 .env；backend 會缺少必要環境變數。請先依 .env.example 建立 .env。"
  exit 1
fi

if ! "$PYTHON_BIN" -m uvicorn --version >/dev/null 2>&1; then
  echo "找不到 uvicorn：目前使用 $PYTHON_BIN。"
  echo "請先安裝 backend 依賴，例如："
  echo "  $PYTHON_BIN -m pip install -r backend/requirements-dev.txt"
  exit 1
fi

echo "啟動 backend: http://localhost:8000"
"$PYTHON_BIN" -m uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000 --env-file .env &
BACKEND_PID=$!

echo "啟動 web: http://localhost:5173"
npm --prefix web run dev &
WEB_PID=$!

echo ""
echo "前後端已啟動。按 Ctrl-C 可一起關閉。"
echo ""

while true; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    wait "$BACKEND_PID" || true
    exit 1
  fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    wait "$WEB_PID" || true
    exit 1
  fi
  sleep 1
done
