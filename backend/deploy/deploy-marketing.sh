#!/usr/bin/env bash
# Deploy Path+ API (marketing pages + legal) to the VPS and restart PM2.
# Run ON the VPS from the backend directory:
#   bash deploy/deploy-marketing.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Installing deps"
bun install

echo "==> Seeding legal CMS content (safe unless --force)"
bun run scripts/seed-legal-content.ts || true

echo "==> Installing nginx site (marketing + api + admin)"
if [[ "$(id -u)" -eq 0 ]]; then
  bash deploy/nginx-setup.sh || true
else
  sudo bash deploy/nginx-setup.sh || true
fi

echo "==> Restarting API"
pm2 restart pathplus-api --update-env || pm2 restart ecosystem.config.cjs --update-env
pm2 save || true

echo "==> Smoke test"
curl -sS -o /dev/null -w "home %{http_code}\n" http://127.0.0.1:3000/ || true
curl -sS -o /dev/null -w "support %{http_code}\n" http://127.0.0.1:3000/support || true
curl -sS -o /dev/null -w "privacy %{http_code}\n" http://127.0.0.1:3000/privacy || true
curl -sS -o /dev/null -w "terms %{http_code}\n" http://127.0.0.1:3000/terms || true

echo "Done. Public URLs:"
echo "  https://www.pathplus.store/"
echo "  https://www.pathplus.store/support"
echo "  https://www.pathplus.store/privacy"
echo "  https://www.pathplus.store/terms"
echo "  (fallback) https://api.pathplus.store/support"
