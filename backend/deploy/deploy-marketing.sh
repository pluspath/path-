#!/usr/bin/env bash
# Deploy Path+ API (marketing pages + legal) to the VPS and restart PM2.
# IMPORTANT: marketing source files must already exist on the server.
# If smoke tests return 404, run:
#   bash deploy/install-marketing-routes.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Backend: $ROOT"

MISSING=0
for f in \
  src/routes/content.ts \
  src/lib/marketing-site.ts \
  src/lib/markdown-html.ts \
  src/lib/legal-seed.ts
do
  if [[ ! -f "$f" ]]; then
    echo "MISSING: $f"
    MISSING=1
  fi
done

if [[ "$MISSING" -eq 1 ]]; then
  echo ""
  echo "Marketing route files are not on this server (that is why you get 404)."
  if [[ -f deploy/marketing-files.tar.gz ]]; then
    echo "Found deploy/marketing-files.tar.gz — installing now..."
    bash deploy/install-marketing-routes.sh
    exit $?
  fi
  echo "Copy deploy/marketing-files.tar.gz from your PC, then run:"
  echo "  bash deploy/install-marketing-routes.sh"
  exit 1
fi

if ! grep -q 'legalPagesRouter' src/index.ts; then
  echo "src/index.ts does not mount legalPagesRouter."
  echo "Run: bash deploy/install-marketing-routes.sh"
  exit 1
fi

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
sleep 2

echo "==> Smoke test"
fail=0
for p in / /support /privacy /terms; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000$p" || echo err)
  echo "  $p -> $code"
  if [[ "$code" != "200" ]]; then fail=1; fi
done

if [[ "$fail" -ne 0 ]]; then
  echo "Smoke test failed. Try: bash deploy/install-marketing-routes.sh"
  echo "Logs: pm2 logs pathplus-api --lines 80"
  exit 1
fi

echo "Done. Public URLs:"
echo "  https://www.pathplus.store/"
echo "  https://www.pathplus.store/support"
echo "  https://www.pathplus.store/privacy"
echo "  https://www.pathplus.store/terms"
echo "  (fallback) https://api.pathplus.store/support"
