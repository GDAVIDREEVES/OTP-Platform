#!/usr/bin/env bash
# Store (or rotate) the Claude API key for the Research Brain without the key
# ever appearing on screen or in shell history: paste it at the hidden prompt.
#
#   ./scripts/set-anthropic-key.sh
#
# The running OTP server picks the new key up on its next request — no restart.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
ENV_FILE="backend/.env"

echo "Create / copy a key at https://console.anthropic.com/settings/keys, then paste it here."
read -r -s -p "ANTHROPIC_API_KEY (input hidden): " KEY; echo
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"
case "$KEY" in
  sk-ant-*) ;;
  *) echo "Error: that does not look like an Anthropic key (expected it to start with sk-ant-)." >&2; exit 1 ;;
esac
if [[ ${#KEY} -lt 100 ]]; then
  echo "Error: key is ${#KEY} characters; a full key is ~108. It was probably cut off — copy it again from the console." >&2
  exit 1
fi

touch "$ENV_FILE"
{ grep -vE '^ANTHROPIC_API_KEY=' "$ENV_FILE" || true; } > "$ENV_FILE.tmp"
printf 'ANTHROPIC_API_KEY=%s\n' "$KEY" >> "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"
echo "  saved to $ENV_FILE (${#KEY} characters)"

OTP_URL="${OTP_URL:-http://127.0.0.1:${PORT:-8000}}"
status="$(curl -s --max-time 20 "$OTP_URL/api/research-brain/status" 2>/dev/null || true)"
if [[ -n "$status" ]]; then
  case "$status" in
    *'"key_valid":true'*)  echo "  ✓ Claude API accepted the key." ;;
    *'"key_valid":false'*) echo "  ✗ Claude API rejected the key: $status" ;;
    *) echo "  status: $status" ;;
  esac
else
  echo "  (OTP server not running at $OTP_URL — it will use the key when started with ./scripts/serve.sh)"
fi
echo "  If this replaced a key that was shared or exposed, delete the old one in the console."
