#!/usr/bin/env bash
# Apply direct marketing page registration on the VPS (fixes empty 404).
# Usage:
#   cd /root/path-/backend
#   bash deploy/apply-direct-marketing.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Backend: $ROOT"

if [[ ! -f src/routes/content.ts ]]; then
  echo "Missing src/routes/content.ts"
  exit 1
fi

if ! grep -q 'export function registerMarketingPages' src/routes/content.ts; then
  echo "==> content.ts missing registerMarketingPages — extracting from tarball if present"
  if [[ -f deploy/marketing-files.tar.gz ]]; then
    tar -xzf deploy/marketing-files.tar.gz -C "$ROOT"
  else
    echo "ERROR: Copy updated files from your PC:"
    echo "  src/routes/content.ts"
    echo "  src/index.ts"
    echo "  src/lib/marketing-site.ts"
    echo "  src/lib/legal-seed.ts"
    echo "  src/lib/markdown-html.ts"
    exit 1
  fi
fi

echo "==> Patching index.ts to call registerMarketingPages(app)"
bun run deploy/patch-direct-marketing.ts

echo "==> Restarting API"
pm2 restart pathplus-api --update-env || pm2 start ecosystem.config.cjs --only pathplus-api --update-env
pm2 save || true
sleep 2

echo "==> Logs (expect: [marketing] pages registered)"
pm2 logs pathplus-api --lines 20 --nostream || true

echo "==> Smoke test"
fail=0
for p in / /support /privacy /terms /health; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000$p" || echo err)
  body=$(curl -sS "http://127.0.0.1:3000$p" | head -c 80 | tr '\n' ' ')
  echo "  $p -> $code  ${body:0:60}"
  if [[ "$p" != "/health" && "$code" != "200" ]]; then fail=1; fi
done

if [[ "$fail" -ne 0 ]]; then
  echo "Still failing. Run:"
  echo "  grep -n registerMarketingPages src/index.ts src/routes/content.ts"
  echo "  ss -tlnp | grep 3000"
  exit 1
fi

echo "OK. Public:"
echo "  https://site.pathplus.store/"
echo "  https://site.pathplus.store/privacy"
