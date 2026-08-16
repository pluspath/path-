#!/usr/bin/env bash
# Diagnose + repair admin login on the VPS.
# Usage (from backend/):
#   bash deploy/fix-admin-login.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Backend dir: $ROOT"

if [[ ! -f src/index.ts ]]; then
  echo "ERROR: src/index.ts missing — wrong directory?"
  exit 1
fi

if ! grep -q '/api/admin/auth/ready' src/index.ts; then
  echo "ERROR: src/index.ts is missing the /api/admin/auth/ready route."
  echo "Copy the latest backend code to this server, then re-run."
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

echo "==> Force-restart API from this folder (delete + start)"
if ! command -v pm2 >/dev/null 2>&1; then
  echo "PM2 is not installed. Install with: npm i -g pm2"
  exit 1
fi

pm2 delete pathplus-api >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs --only pathplus-api
pm2 save

echo ""
echo "==> Waiting for boot"
sleep 2

echo "==> Health"
curl -sS "http://127.0.0.1:3000/health" || true
echo ""
echo "==> Admin ready"
LOCAL_READY="$(curl -sS "http://127.0.0.1:3000/api/admin/auth/ready" || true)"
echo "$LOCAL_READY"
echo ""

if echo "$LOCAL_READY" | grep -q '404'; then
  echo "Still 404. Showing PM2 logs:"
  pm2 logs pathplus-api --lines 40 --nostream || true
  exit 1
fi

if echo "$LOCAL_READY" | grep -q '"canLogin":true'; then
  echo "OK — login should work at https://admin.pathplus.store"
  exit 0
fi

echo "Endpoint works, but login is not ready yet:"
echo "  jwtConfigured=false  → check ADMIN_JWT_SECRET"
echo "  adminTablesOk=false  → run migrations/001_admin_system.sql in Supabase SQL Editor"
echo "  adminUserCount=0     → ADMIN_DEFAULT_PASSWORD='YourStrongPass12!' bun run seed:admin"
pm2 logs pathplus-api --lines 30 --nostream || true
