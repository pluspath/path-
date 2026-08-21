#!/usr/bin/env bash
# Safe VPS fix for admin login (no huge paste blocks).
set -euo pipefail
cd /root/path-/backend

echo "==> Ensure ADMIN_JWT_SECRET"
if ! grep -qE '^ADMIN_JWT_SECRET=.{32,}' .env 2>/dev/null; then
  echo "ADMIN_JWT_SECRET=$(openssl rand -hex 48)" >> .env
  echo "wrote ADMIN_JWT_SECRET"
else
  echo "ADMIN_JWT_SECRET present"
fi

# Normalize backend URL
if grep -q '^BACKEND_URL=' .env; then
  sed -i 's|^BACKEND_URL=.*|BACKEND_URL=https://api.pathplus.store|' .env
else
  echo 'BACKEND_URL=https://api.pathplus.store' >> .env
fi

if grep -q '^ADMIN_CORS_ORIGIN=' .env; then
  sed -i 's|^ADMIN_CORS_ORIGIN=.*|ADMIN_CORS_ORIGIN=https://admin.pathplus.store,http://admin.pathplus.store,http://localhost:3001,http://127.0.0.1:3001|' .env
else
  echo 'ADMIN_CORS_ORIGIN=https://admin.pathplus.store,http://admin.pathplus.store,http://localhost:3001,http://127.0.0.1:3001' >> .env
fi

echo "==> Diagnose"
bun scripts/diag-admin.ts || true

echo "==> Restart API"
pm2 delete pathplus-api >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs --only pathplus-api
pm2 save
sleep 2

echo "==> API logs (look for errors)"
pm2 logs pathplus-api --lines 40 --nostream || true

echo ""
echo "Next:"
echo "  1) If adminTablesOk=false → run migrations/001_admin_system.sql in Supabase"
echo "  2) If adminUserExists=false → ADMIN_DEFAULT_PASSWORD='Admin@PathPlus2026!' bun run seed:admin"
echo "  3) Optional reset password → RESET_ADMIN_PASSWORD='Admin@PathPlus2026!' bun scripts/diag-admin.ts"
echo "  4) Login at https://admin.pathplus.store  (user: admin)"
