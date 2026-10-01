#!/usr/bin/env bash
# Connect the OTP Platform's Research Brain to the researchbrain knowledge
# service so answers come back cited (purple "knowledge base · cited" chip).
#
#   ./scripts/connect-researchbrain.sh                 # auto-locate the research-brain repo
#   ./scripts/connect-researchbrain.sh /path/to/research-brain
#   ./scripts/connect-researchbrain.sh --no-start      # only write settings, don't start the daemon
#   RB_URL=http://mac-mini.local:3000 ./scripts/connect-researchbrain.sh --no-start   # daemon on another machine
#
# What it does:
#   1. finds the research-brain checkout and reads RESEARCHBRAIN_API_KEY from its .env
#   2. writes RESEARCH_BRAIN_BASE_URL + RESEARCH_BRAIN_API_KEY into backend/.env (other lines kept)
#   3. starts the researchbrain daemon (`npm start`, background, log in /tmp) if nothing answers on the port
#   4. waits for its health check and prints the OTP status — no OTP restart needed, the
#      server re-reads backend/.env on the next request and the badge flips by itself.

set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

START=1; RB_DIR=""
for arg in "$@"; do
  case "$arg" in
    --no-start) START=0 ;;
    *) RB_DIR="$arg" ;;
  esac
done

RB_URL="${RB_URL:-http://127.0.0.1:3000}"
OTP_URL="${OTP_URL:-http://127.0.0.1:${PORT:-8000}}"
ENV_FILE="backend/.env"

# ---- 1. locate research-brain ------------------------------------------------
if [[ -z "$RB_DIR" ]]; then
  for cand in "$HOME/Documents/research-brain" "$HOME/research-brain" "$HOME/Desktop/research-brain" "$ROOT_DIR/../research-brain"; do
    [[ -f "$cand/.env" && -f "$cand/server.js" ]] && { RB_DIR="$cand"; break; }
  done
fi
if [[ -z "$RB_DIR" ]]; then
  found="$(find "$HOME" -maxdepth 5 -type f -path '*/research-brain/server.js' -not -path '*/node_modules/*' 2>/dev/null | head -1 || true)"
  [[ -n "$found" ]] && RB_DIR="$(dirname "$found")"
fi
[[ -n "$RB_DIR" && -f "$RB_DIR/.env" ]] || { echo "Error: research-brain checkout not found. Pass its path: $0 /path/to/research-brain" >&2; exit 1; }
echo "  research-brain: $RB_DIR"

TOKEN="$(grep -E '^RESEARCHBRAIN_API_KEY=' "$RB_DIR/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
[[ -n "$TOKEN" ]] || { echo "Error: RESEARCHBRAIN_API_KEY is not set in $RB_DIR/.env (researchbrain fails closed without it)." >&2; exit 1; }

# ---- 2. write OTP settings (replace existing lines, keep everything else) -----
touch "$ENV_FILE"
{ grep -vE '^(RESEARCH_BRAIN_BASE_URL|RESEARCH_BRAIN_API_KEY)=' "$ENV_FILE" || true; } > "$ENV_FILE.tmp"
printf 'RESEARCH_BRAIN_BASE_URL=%s\nRESEARCH_BRAIN_API_KEY=%s\n' "$RB_URL" "$TOKEN" >> "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"
echo "  wrote RESEARCH_BRAIN_BASE_URL / RESEARCH_BRAIN_API_KEY to $ENV_FILE"
grep -qE '^ANTHROPIC_API_KEY=.+' "$ENV_FILE" || echo "  note: ANTHROPIC_API_KEY is not set in $ENV_FILE — cited answers need it for synthesis (./scripts/set-anthropic-key.sh)"

# ---- 3. start the daemon if nothing is listening ------------------------------
# curl prints 000 itself on a refused connection (and exits non-zero), so just
# swallow the exit status; never append a second fallback value.
health() { local c; c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$RB_URL/api/rag/health" 2>/dev/null || true)"; printf '%s' "${c:-000}"; }
code="$(health)"
if [[ "$code" == "000" && "$START" == "1" ]]; then
  if [[ ! -d "$RB_DIR/node_modules" ]]; then
    echo "  installing research-brain dependencies (first time)…"
    (cd "$RB_DIR" && npm install --no-audit --no-fund >/tmp/researchbrain-install.log 2>&1) || { echo "Error: npm install failed — see /tmp/researchbrain-install.log" >&2; exit 1; }
  fi
  echo "  starting researchbrain daemon (log: /tmp/researchbrain.log)…"
  (cd "$RB_DIR" && nohup npm start >/tmp/researchbrain.log 2>&1 &)
  for _ in $(seq 1 40); do sleep 1; code="$(health)"; [[ "$code" != "000" ]] && break; done
fi

# ---- 4. report --------------------------------------------------------------
case "$code" in
  200) echo "  researchbrain: healthy at $RB_URL" ;;
  503) echo "  researchbrain: running at $RB_URL but its Qdrant vector store is not connected — start Qdrant (Docker) and it will recover; until then answers fall back to Claude direct" ;;
  000) echo "  researchbrain: nothing answering at $RB_URL (see /tmp/researchbrain.log). Answers fall back to Claude direct until it is up." ;;
  *)   echo "  researchbrain: health returned HTTP $code" ;;
esac

status="$(curl -s --max-time 20 "$OTP_URL/api/research-brain/status" 2>/dev/null || true)"
if [[ -n "$status" ]]; then
  echo ""
  echo "  OTP Research Brain status: $status"
  echo ""
  case "$status" in
    *'"mode":"researchbrain"'*) echo "  ✓ Knowledge base connected — answers will carry the purple cited chip." ;;
    *'"mode":"claude"'*)        echo "  Claude direct for now; the badge flips to 'Knowledge base connected' on its own once researchbrain is healthy." ;;
    *)                          echo "  Offline — check ANTHROPIC_API_KEY (./scripts/set-anthropic-key.sh)." ;;
  esac
else
  echo "  (OTP server not running at $OTP_URL — start it with ./scripts/serve.sh; settings are saved.)"
fi
