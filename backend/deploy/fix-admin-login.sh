#!/usr/bin/env bash
# Diagnose + repair admin login on the VPS.
# Usage (from backend/):
#   bash deploy/fix-admin-login.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Checking .env"
if [[ ! -f .env ]]; then
  echo "Missing .env in $ROOT"
  exit 1
fi

if ! grep -q '^ADMIN_JWT_SECRET=.\+' .env; then
  echo "ADMIN_JWT_SECRET is missing — generating one"
  SECRET="$(openssl rand -hex 48)"
  echo "ADMIN_JWT_SECRET=$SECRET" >> .env
fi

if ! grep -q '^BACKEND_URL=https://api.pathplus.store' .env; then
  echo "Tip: set BACKEND_URL=https://api.pathplus.store in .env"
fi

echo "==> Restarting API with updated env"
if command -v pm2 >/dev/null 2>&1 && pm2 describe pathplus-api >/dev/null 2>&1; then
  pm2 restart pathplus-api --update-env
  pm2 save
else
  echo "PM2 process pathplus-api not found. Start with: bash deploy/pm2-setup.sh"
fi

echo ""
echo "==> Readiness check"
sleep 1
curl -sS "https://api.pathplus.store/api/admin/auth/ready" || curl -sS "http://127.0.0.1:3000/api/admin/auth/ready" || true
echo ""
echo ""
echo "If adminTablesOk=false → run migrations/001_admin_system.sql in Supabase SQL Editor"
echo "If adminUserCount=0 → run: ADMIN_DEFAULT_PASSWORD='YourStrongPass12' bun run seed:admin"
echo "Then try login again at https://admin.pathplus.store"
