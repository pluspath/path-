#!/usr/bin/env bash
# Connect marketing (site) + api + admin via Nginx.
# Run on the VPS as root (or with sudo):
#   sudo bash deploy/nginx-setup.sh
#   sudo bash deploy/nginx-setup.sh --ssl

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF_SRC="$ROOT/deploy/nginx.pathplus.conf"
SITE_NAME="pathplus"
AVAILABLE="/etc/nginx/sites-available/$SITE_NAME"
ENABLED="/etc/nginx/sites-enabled/$SITE_NAME"
ENABLE_SSL=0

for arg in "$@"; do
  case "$arg" in
    --ssl) ENABLE_SSL=1 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/nginx-setup.sh"
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "Nginx not found. Install with: apt update && apt install -y nginx"
  exit 1
fi

if [[ ! -f "$CONF_SRC" ]]; then
  echo "Missing config: $CONF_SRC"
  exit 1
fi

echo "==> Installing Nginx site for:"
echo "    https://site.pathplus.store  → :3000 (marketing)"
echo "    https://api.pathplus.store   → :3000"
echo "    https://admin.pathplus.store → :3001"

cp "$CONF_SRC" "$AVAILABLE"
ln -sfn "$AVAILABLE" "$ENABLED"

# Remove older duplicate site configs that also claim api/admin (causes "conflicting server name")
for old in pathplus-api pathplus-admin default; do
  if [[ -e "/etc/nginx/sites-enabled/$old" ]]; then
    echo "==> Removing duplicate site: $old"
    rm -f "/etc/nginx/sites-enabled/$old"
  fi
done

echo "==> Testing Nginx config"
nginx -t

echo "==> Reloading Nginx"
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx

if [[ "$ENABLE_SSL" -eq 1 ]]; then
  if ! command -v certbot >/dev/null 2>&1; then
    echo "Certbot not found. Install with: apt install -y certbot python3-certbot-nginx"
    exit 1
  fi
  echo "==> Requesting / expanding TLS certificates"
  certbot --nginx \
    -d api.pathplus.store \
    -d admin.pathplus.store \
    -d site.pathplus.store \
    -d www.pathplus.store \
    -d pathplus.store \
    --expand \
    --non-interactive --agree-tos --redirect \
    --register-unsafely-without-email || \
  certbot --nginx \
    -d api.pathplus.store \
    -d admin.pathplus.store \
    -d site.pathplus.store \
    -d www.pathplus.store \
    -d pathplus.store \
    --expand --redirect
fi

echo ""
echo "Done. Test with HTTPS:"
echo "  curl https://api.pathplus.store/health"
echo "  curl -I https://site.pathplus.store/"
echo "  curl -I https://site.pathplus.store/support"
echo "  curl -I https://admin.pathplus.store/"
echo ""
echo "Links:"
echo "  Marketing: https://site.pathplus.store"
echo "  Support:   https://site.pathplus.store/support"
echo "  Privacy:   https://site.pathplus.store/privacy"
echo "  Terms:     https://site.pathplus.store/terms"
echo "  API:       https://api.pathplus.store"
echo "  Admin:     https://admin.pathplus.store"
