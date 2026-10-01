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

# If an earlier copy of THIS server is still holding the port (a previous
# serve.sh left running in another Terminal tab), replace it rather than
# failing with "address already in use". Anything else on the port is left
# alone and named so you can decide.
if command -v lsof >/dev/null 2>&1; then
  for pid in $(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null); do
    if ps -o args= -p "$pid" 2>/dev/null | grep -q "uvicorn main:app"; then
      echo "  Stopping previous OTP Platform server (pid $pid) on port $PORT…"
      kill "$pid" 2>/dev/null || true
      for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    else
      echo "Error: port $PORT is in use by another program:" >&2
      ps -o pid=,args= -p "$pid" >&2
      echo "Stop it, or run with a different port:  PORT=8080 ./scripts/serve.sh" >&2
      exit 1
    fi
  done
fi
echo ""
if [[ -n "${CODESPACE_NAME:-}" ]]; then
  # Inside GitHub Codespaces the browser reaches the app through the forwarded
  # port, not localhost. Print the real URL (also under the PORTS tab).
  echo "  OTP Platform (Codespaces): https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  echo "  (or: PORTS tab at the bottom of VS Code → port ${PORT} → globe icon)"
else
  echo "  OTP Platform: http://localhost:${PORT}   (API docs at /docs)"
fi
echo ""
cd backend
exec "$PY" -m uvicorn main:app --host "$HOST" --port "$PORT"
