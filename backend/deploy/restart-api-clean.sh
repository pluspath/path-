#!/usr/bin/env bash
# Free port 3000 and restart API so marketing routes actually serve traffic.
#   cd /root/path-/backend && bash deploy/restart-api-clean.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Stopping pathplus-api"
pm2 stop pathplus-api || true
pm2 delete pathplus-api || true
sleep 1

echo "==> Killing anything still on :3000"
if command -v fuser >/dev/null 2>&1; then
  fuser -k 3000/tcp 2>/dev/null || true
fi
if command -v lsof >/dev/null 2>&1; then
  lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true
fi
sleep 1
ss -tlnp | grep 3000 || echo "  (port 3000 is free)"

echo "==> Starting pathplus-api"
if [[ -f ecosystem.config.cjs ]]; then
  pm2 start ecosystem.config.cjs --only pathplus-api --update-env
else
  pm2 start src/index.ts --name pathplus-api --interpreter bun --update-env
fi
pm2 save || true
sleep 3

echo "==> Who answers on :3000?"
curl -sS http://127.0.0.1:3000/health || true
echo
curl -sS http://127.0.0.1:3000/__marketing || true
echo

echo "==> Smoke"
for p in / /support /privacy /terms; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000$p" || echo err)
  echo "  $p -> $code"
done

echo "==> Public"
curl -sS -o /dev/null -w "site/privacy -> %{http_code}\n" https://site.pathplus.store/privacy || true
