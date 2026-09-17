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
(
  cd admin
  bun install
  bun run build
)

echo "==> Starting (or reloading) PM2 apps"
if pm2 describe pathplus-api >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi

pm2 save --force

echo "==> Enable start on server reboot"
if [[ "$(id -u)" -eq 0 ]]; then
  bash "$ROOT/deploy/enable-boot.sh"
else
  echo "  Not root — run once as root to survive reboots:"
  echo "    sudo bash deploy/enable-boot.sh"
  pm2 startup || true
fi

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
echo "  pm2 save --force"
echo "  sudo bash deploy/enable-boot.sh   # one-time: auto-start after reboot"
