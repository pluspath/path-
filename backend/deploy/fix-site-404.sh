#!/usr/bin/env bash
# Fix 404 on https://site.pathplus.store (and /privacy /support /terms).
# Run on the VPS from the backend root:
#   cd /root/path-/backend   # or your real backend path
#   bash deploy/fix-site-404.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "==> Backend: $ROOT"

# ── 1) Ensure marketing source files exist ─────────────────────────
NEED_EXTRACT=0
for f in \
  src/lib/markdown-html.ts \
  src/lib/legal-seed.ts \
  src/lib/marketing-site.ts \
  src/routes/content.ts
do
  if [[ ! -f "$f" ]]; then
    echo "MISSING: $f"
    NEED_EXTRACT=1
  fi
done

if [[ "$NEED_EXTRACT" -eq 1 ]]; then
  TAR="$ROOT/deploy/marketing-files.tar.gz"
  if [[ ! -f "$TAR" ]]; then
    echo "Missing $TAR — copy it from your PC first."
    exit 1
  fi
  echo "==> Extracting $TAR"
  tar -xzf "$TAR" -C "$ROOT"
fi

# Prefer force-fix so mounts are rewritten even if an old stub exists
if [[ -f deploy/force-fix-marketing.sh ]]; then
  echo "==> Force-fixing marketing route mounts"
  bash deploy/force-fix-marketing.sh
else
  echo "==> Installing marketing routes"
  bash deploy/install-marketing-routes.sh
fi

# ── 2) Seed published Privacy / Terms in CMS ───────────────────────
echo "==> Seeding legal CMS content"
bun run scripts/seed-legal-content.ts || bun run src/lib/legal-seed.ts || true
if [[ -f scripts/seed-legal-content.ts ]]; then
  bun run scripts/seed-legal-content.ts || true
fi

# ── 3) Nginx: site.pathplus.store → API :3000 ──────────────────────
echo "==> Installing nginx (site + api + admin)"
if [[ -f deploy/nginx.pathplus.conf ]]; then
  if [[ "$(id -u)" -eq 0 ]]; then
    bash deploy/nginx-setup.sh --ssl || bash deploy/nginx-setup.sh || true
  else
    sudo bash deploy/nginx-setup.sh --ssl || sudo bash deploy/nginx-setup.sh || true
  fi
else
  echo "WARN: deploy/nginx.pathplus.conf missing — skip nginx"
fi

# Expand cert for site if certbot exists
if command -v certbot >/dev/null 2>&1; then
  echo "==> Ensuring TLS includes site.pathplus.store"
  certbot --nginx \
    -d api.pathplus.store \
    -d admin.pathplus.store \
    -d site.pathplus.store \
    -d www.pathplus.store \
    -d pathplus.store \
    --expand --non-interactive --agree-tos --redirect \
    --register-unsafely-without-email 2>/dev/null || \
  sudo certbot --nginx \
    -d api.pathplus.store \
    -d admin.pathplus.store \
    -d site.pathplus.store \
    -d www.pathplus.store \
    -d pathplus.store \
    --expand --redirect || true
fi

# ── 4) Final smoke (local + public) ────────────────────────────────
echo ""
echo "==> Local smoke (expect 200)"
fail=0
for p in / /support /privacy /terms /health; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000$p" || echo err)
  echo "  :3000$p -> $code"
  if [[ "$p" != "/health" && "$code" != "200" ]]; then fail=1; fi
done

echo ""
echo "==> Public smoke"
for u in \
  "https://api.pathplus.store/privacy" \
  "https://site.pathplus.store/" \
  "https://site.pathplus.store/privacy" \
  "https://site.pathplus.store/support"
do
  code=$(curl -sS -o /dev/null -w "%{http_code}" -m 15 "$u" || echo err)
  echo "  $u -> $code"
done

if [[ "$fail" -ne 0 ]]; then
  echo ""
  echo "Local routes still 404. Debug:"
  echo "  grep -n legalPagesRouter src/index.ts"
  echo "  pm2 logs pathplus-api --lines 80 --nostream"
  exit 1
fi

echo ""
echo "Done. Use these URLs:"
echo "  https://site.pathplus.store/"
echo "  https://site.pathplus.store/privacy"
echo "  https://site.pathplus.store/terms"
echo "  https://site.pathplus.store/support"
