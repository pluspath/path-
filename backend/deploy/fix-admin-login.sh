#!/usr/bin/env bash
# Diagnose + repair admin login on the VPS.
# Usage (from backend/):
#   bash deploy/fix-admin-login.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Backend dir: $ROOT"

if [[ ! -f src/admin/routes/auth.routes.ts ]]; then
  echo "ERROR: src/admin/routes/auth.routes.ts missing — wrong directory?"
  exit 1
fi

if ! grep -q 'authRoutes.get("/ready"' src/admin/routes/auth.routes.ts; then
  echo "ERROR: This server copy does NOT include the login fix (/ready)."
  echo "Copy/pull the latest backend code here, then run this script again."
  exit 1
fi

echo "==> Checking .env"
if [[ ! -f .env ]]; then
  echo "Missing .env in $ROOT"
  exit 1
fi

if ! grep -qE '^ADMIN_JWT_SECRET=.{32,}' .env; then
  echo "ADMIN_JWT_SECRET missing or too short — generating one"
  grep -v '^ADMIN_JWT_SECRET=' .env > .env.tmp || true
  mv .env.tmp .env
  echo "ADMIN_JWT_SECRET=$(openssl rand -hex 48)" >> .env
fi

if grep -q '^BACKEND_URL=http://' .env; then
  echo "==> Updating BACKEND_URL to https://api.pathplus.store"
  sed -i 's|^BACKEND_URL=.*|BACKEND_URL=https://api.pathplus.store|' .env
fi

if ! grep -q '^ADMIN_CORS_ORIGIN=.*admin.pathplus.store' .env; then
  echo "==> Setting ADMIN_CORS_ORIGIN for admin.pathplus.store"
  if grep -q '^ADMIN_CORS_ORIGIN=' .env; then
    sed -i 's|^ADMIN_CORS_ORIGIN=.*|ADMIN_CORS_ORIGIN=https://admin.pathplus.store,http://admin.pathplus.store,http://localhost:3001,http://127.0.0.1:3001|' .env
  else
    echo 'ADMIN_CORS_ORIGIN=https://admin.pathplus.store,http://admin.pathplus.store,http://localhost:3001,http://127.0.0.1:3001' >> .env
  fi
fi

echo "==> Restarting API with updated env"
if command -v pm2 >/dev/null 2>&1 && pm2 describe pathplus-api >/dev/null 2>&1; then
  pm2 restart pathplus-api --update-env
  pm2 save
else
  echo "PM2 process pathplus-api not found. Start with: bash deploy/pm2-setup.sh"
  exit 1
fi

echo ""
echo "==> Local readiness (bypass Cloudflare)"
sleep 1
LOCAL_READY="$(curl -sS "http://127.0.0.1:3000/api/admin/auth/ready" || true)"
echo "$LOCAL_READY"
echo ""

if echo "$LOCAL_READY" | grep -q '404'; then
  echo "Still 404 locally — PM2 is not serving this code folder."
  echo "Check: pm2 show pathplus-api | grep -E 'exec cwd|script path'"
  exit 1
fi

if echo "$LOCAL_READY" | grep -q '"canLogin":true'; then
  echo "OK — login should work at https://admin.pathplus.store"
  exit 0
fi

echo "Login is not ready yet. Read the JSON above:"
echo "  jwtConfigured=false     → ADMIN_JWT_SECRET issue (should be fixed by this script)"
echo "  adminTablesOk=false     → run migrations/001_admin_system.sql in Supabase SQL Editor"
echo "  adminUserCount=0        → ADMIN_DEFAULT_PASSWORD='YourStrongPass12!' bun run seed:admin"
echo ""
echo "Recent API logs:"
pm2 logs pathplus-api --lines 30 --nostream || true
