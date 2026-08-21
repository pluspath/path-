#!/usr/bin/env bash
# Kill stale Bun on :3000 and start the API that has marketing pages.
#   cd /root/path-/backend && bash deploy/fix-stale-port.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Backend: $ROOT"
echo "==> What is on disk?"
if grep -q '__marketing' src/index.ts 2>/dev/null; then
  echo "  src/index.ts has __marketing (new code) OK"
else
  echo "  src/index.ts MISSING __marketing — extracting tarball"
  if [[ -f deploy/marketing-files.tar.gz ]]; then
    tar -xzf deploy/marketing-files.tar.gz -C "$ROOT"
  else
    echo "ERROR: no deploy/marketing-files.tar.gz. Copy it from your PC, then re-run."
    exit 1
  fi
fi

if ! grep -q 'registerMarketingPages' src/index.ts; then
  echo "ERROR: registerMarketingPages still missing after extract"
  exit 1
fi
if ! grep -q 'registerMarketingPages' src/routes/content.ts; then
  echo "ERROR: src/routes/content.ts outdated"
  exit 1
fi

echo "==> PM2 status (before)"
pm2 list || true

echo "==> Stop/delete pathplus-api"
pm2 stop pathplus-api 2>/dev/null || true
pm2 delete pathplus-api 2>/dev/null || true
sleep 1

echo "==> Kill EVERY bun/node listening on :3000"
# Show PIDs first
ss -tlnp | grep 3000 || echo "  (nothing in ss)"
# Kill by port
if command -v fuser >/dev/null 2>&1; then
  fuser -k 3000/tcp 2>/dev/null || true
fi
if command -v lsof >/dev/null 2>&1; then
  lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true
fi
# Kill known stale pattern
pkill -9 -f 'path-/backend/src/index.ts' 2>/dev/null || true
pkill -9 -f 'backend/src/index.ts' 2>/dev/null || true
sleep 2

if ss -tlnp | grep -q 3000; then
  echo "WARNING: port 3000 still busy:"
  ss -tlnp | grep 3000
  # Last resort: parse pid from ss and kill
  PIDS=$(ss -tlnp | grep 3000 | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | sort -u)
  for p in $PIDS; do
    echo "  kill -9 $p"
    kill -9 "$p" 2>/dev/null || true
  done
  sleep 1
fi

ss -tlnp | grep 3000 && echo "FATAL: could not free :3000" && exit 1 || echo "  port 3000 is free"

echo "==> Start API"
if [[ -f ecosystem.config.cjs ]]; then
  pm2 start ecosystem.config.cjs --only pathplus-api --update-env
else
  pm2 start src/index.ts --name pathplus-api --interpreter bun --cwd "$ROOT" --update-env
fi
pm2 save || true
sleep 3

echo "==> Boot logs"
pm2 logs pathplus-api --lines 25 --nostream || true

echo "==> Verify (must show marketing:true)"
echo -n "health: "; curl -sS http://127.0.0.1:3000/health; echo
echo -n "__marketing: "; curl -sS http://127.0.0.1:3000/__marketing; echo
echo -n "privacy: "; curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/privacy
echo -n "home: "; curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
echo -n "site/privacy: "; curl -sS -o /dev/null -w "%{http_code}\n" https://site.pathplus.store/privacy || true

if ! curl -sS http://127.0.0.1:3000/health | grep -q marketing; then
  echo ""
  echo "FAILED: still old process. Paste:"
  echo "  ss -tlnp | grep 3000"
  echo "  pm2 show pathplus-api"
  echo "  head -n 40 src/index.ts"
  exit 1
fi

echo ""
echo "SUCCESS — open https://site.pathplus.store/privacy"
