#!/usr/bin/env bash
# Fix 502 on https://admin.pathplus.store (nginx cannot reach Next.js on :3001).
#
# Run on the VPS:
#   cd /root/path-/backend
#   sed -i 's/\r$//' deploy/fix-admin-502.sh
#   bash deploy/fix-admin-502.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Backend: $ROOT"
echo "==> Local checks (before)"
echo -n "  API  :3000  "; curl -sS -m 5 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/health || echo "DOWN"
echo -n "  Admin:3001  "; curl -sS -m 5 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/ || echo "DOWN"
echo
ss -tlnp 2>/dev/null | grep -E ':3000|:3001' || echo "  (ss: nothing on 3000/3001)"
echo
pm2 list || true

if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: pm2 not found. Install: npm i -g pm2"
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "ERROR: bun not found."
  exit 1
fi

# Ensure admin build exists
if [[ ! -d admin/.next ]]; then
  echo "==> admin/.next missing — building admin dashboard"
  bun install --cwd admin
  ( cd admin && bun run build )
elif [[ ! -f admin/.next/BUILD_ID ]]; then
  echo "==> admin/.next incomplete — rebuilding"
  bun install --cwd admin
  ( cd admin && bun run build )
else
  echo "==> admin/.next present (BUILD_ID=$(cat admin/.next/BUILD_ID 2>/dev/null || echo '?'))"
fi

echo "==> Restarting pathplus-admin"
if pm2 describe pathplus-admin >/dev/null 2>&1; then
  pm2 restart pathplus-admin --update-env
else
  echo "==> pathplus-admin not in PM2 — starting from ecosystem.config.cjs"
  if [[ -f ecosystem.config.cjs ]]; then
    pm2 start ecosystem.config.cjs --only pathplus-admin --update-env
  else
    pm2 start node_modules/next/dist/bin/next \
      --name pathplus-admin \
      --interpreter bun \
      --cwd "$ROOT/admin" \
      -- start -p 3001 -H 0.0.0.0
  fi
fi
pm2 save || true

echo "==> Waiting for :3001"
ok=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  code="$(curl -sS -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/ 2>/dev/null || echo 000)"
  if [[ "$code" == "200" || "$code" == "307" || "$code" == "308" || "$code" == "302" ]]; then
    ok=1
    echo "  local / -> $code"
    break
  fi
  echo "  attempt $i: $code (waiting…)"
  sleep 2
done

echo
echo "==> PM2 status"
pm2 list
echo
echo "==> Recent admin logs"
pm2 logs pathplus-admin --lines 30 --nostream || true

echo
echo -n "local  http://127.0.0.1:3001/        -> "
curl -sS -m 5 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/ || echo "FAIL"
echo -n "public https://admin.pathplus.store/ -> "
curl -sS -m 10 -o /dev/null -w "%{http_code}\n" https://admin.pathplus.store/ || echo "FAIL"

if [[ "$ok" -ne 1 ]]; then
  echo
  echo "FAILED: admin still not answering on :3001"
  echo "  pm2 logs pathplus-admin --lines 80"
  echo "  ss -tlnp | grep 3001"
  echo "  ls -la admin/.next"
  exit 1
fi

PUBLIC="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' https://admin.pathplus.store/ 2>/dev/null || echo 000)"
if [[ "$PUBLIC" == "502" || "$PUBLIC" == "000" ]]; then
  echo
  echo "Local admin is OK, but public still $PUBLIC."
  echo "  1) Check nginx: sudo nginx -t && sudo systemctl reload nginx"
  echo "  2) Purge Cloudflare cache for admin.pathplus.store"
  echo "  3) Confirm Cloudflare origin points at this VPS"
  exit 1
fi

echo
echo "OK — open https://admin.pathplus.store/"
