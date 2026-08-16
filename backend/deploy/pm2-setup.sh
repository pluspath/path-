#!/usr/bin/env bash
# Keep Path+ API + Admin running continuously via PM2 (auto-restart + boot on reboot).
# Run on the VPS from the backend directory:
#   bash deploy/pm2-setup.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "PM2 is not installed. Install with: npm i -g pm2"
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is not installed. Install from https://bun.sh"
  exit 1
fi

echo "==> Installing backend deps"
bun install

echo "==> Installing + building admin dashboard"
bun --cwd admin install
bun --cwd admin run build

echo "==> Starting (or reloading) PM2 apps"
if pm2 describe pathplus-api >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi

pm2 save

echo "==> Enable start on server reboot (run the command PM2 prints if first time)"
pm2 startup || true

echo ""
echo "Status:"
pm2 status
echo ""
echo "API:   http://api.pathplus.store"
echo "Admin: http://admin.pathplus.store"
echo ""
echo "Useful commands:"
echo "  pm2 status"
echo "  pm2 logs"
echo "  pm2 restart all --update-env"
echo "  pm2 save"
