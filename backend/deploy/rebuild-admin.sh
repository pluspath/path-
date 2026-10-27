#!/usr/bin/env bash
# Rebuild the admin dashboard and restart the live process.
#
# Next.js keeps prerendered pages and the static-file index in memory.
# Replacing admin/.next without restarting pathplus-admin leaves
# https://admin.pathplus.store/login pointing at JavaScript files that
# no longer exist. The browser then shows a client-side exception.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/admin"

export PATH="${BUN_INSTALL:-$HOME/.bun}/bin:/usr/local/bin:/usr/bin:$PATH"
export NODE_ENV=production
export API_INTERNAL_URL="${API_INTERNAL_URL:-http://127.0.0.1:3000}"

bun run build

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Build finished. Restart as root: systemctl restart pathplus-admin"
  exit 0
fi

systemctl restart pathplus-admin

ok=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  code="$(curl -sS -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/login || echo 000)"
  echo "attempt $i: $code"
  if [[ "$code" == "200" ]]; then
    ok=1
    break
  fi
  sleep 2
done

if [[ "$ok" != "1" ]]; then
  echo "Dashboard did not come back. Last logs:"
  journalctl -u pathplus-admin -n 40 --no-pager || true
  exit 1
fi

html="$(curl -sS -m 10 http://127.0.0.1:3001/login)"
chunk="$(printf '%s' "$html" | grep -oE '/_next/static/chunks/app/login/page-[a-f0-9]+\.js' | head -1)"
if [[ -z "$chunk" ]]; then
  echo "Login page did not reference a login script."
  exit 1
fi
status="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:3001$chunk")"
echo "login chunk $chunk -> $status"
if [[ "$status" != "200" ]]; then
  exit 1
fi

echo "OK — https://admin.pathplus.store/login"
