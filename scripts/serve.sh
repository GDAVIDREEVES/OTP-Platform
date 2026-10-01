#!/usr/bin/env bash
# Run the whole OTP Platform on ONE port (default :8000): builds the React app
# into dist/ (unless --no-build) and starts FastAPI, which serves both the API
# and the built SPA. This is the "run it from any computer" mode — no Vite dev
# server, no CORS, one URL to open.
#
#   ./scripts/serve.sh                 # build + serve on http://127.0.0.1:8000
#   HOST=0.0.0.0 PORT=8080 ./scripts/serve.sh   # bind for other machines / containers
#   ./scripts/serve.sh --no-build      # reuse an existing dist/

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PY="$ROOT_DIR/.venv/bin/python"
[[ -x "$PY" ]] || PY="$(command -v python3)"

if [[ "${1:-}" != "--no-build" ]]; then
  if [[ ! -d node_modules ]]; then
    echo "node_modules missing — running npm install" >&2
    npm install --no-audit --no-fund
  fi
  npm run build
fi

[[ -f dist/index.html ]] || { echo "dist/index.html not found — run without --no-build" >&2; exit 1; }

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"
echo ""
echo "  OTP Platform: http://${HOST}:${PORT}   (API docs at /docs)"
echo ""
cd backend
exec "$PY" -m uvicorn main:app --host "$HOST" --port "$PORT"
