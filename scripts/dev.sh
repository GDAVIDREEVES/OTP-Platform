#!/usr/bin/env bash
# Boot the OTP Platform local dev stack: FastAPI (uvicorn) on :8000 and
# Vite on :5173. Stream both logs with [api]/[web] prefixes; one Ctrl-C
# tears everything down.
#
# Run from the repo root:  ./scripts/dev.sh

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d .venv ]]; then
  echo "Error: .venv not found at $ROOT_DIR/.venv" >&2
  echo "First-time setup:" >&2
  echo "  /opt/homebrew/bin/python3.13 -m venv .venv" >&2
  echo "  .venv/bin/pip install -r backend/requirements.txt" >&2
  echo "  npm install" >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Error: node_modules not found. Run 'npm install' first." >&2
  exit 1
fi

API_PID=""
WEB_PID=""

cleanup() {
  trap - INT TERM EXIT
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "$WEB_PID" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# uvicorn on :8000 with reload — stream stdout+stderr through sed prefix
(
  cd "$ROOT_DIR/backend"
  exec "$ROOT_DIR/.venv/bin/uvicorn" main:app --reload --port 8000 2>&1 \
    | sed -u 's/^/[api] /'
) &
API_PID=$!

# Vite on :5173 — same prefix treatment
(
  cd "$ROOT_DIR"
  exec npm run dev --silent 2>&1 \
    | sed -u 's/^/[web] /'
) &
WEB_PID=$!

sleep 1
echo ""
echo "  API: http://127.0.0.1:8000   (PID $API_PID)"
echo "  Web: http://127.0.0.1:5173   (PID $WEB_PID)"
echo "  Ctrl-C to stop both."
echo ""

wait
