#!/usr/bin/env bash
# Connect api.pathplus.store + admin.pathplus.store via Nginx.
# Run on the VPS as root (or with sudo):
#   sudo bash deploy/nginx-setup.sh
#
# Optional HTTPS after DNS works:
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
echo "    http://api.pathplus.store   → :3000"
echo "    http://admin.pathplus.store → :3001"

cp "$CONF_SRC" "$AVAILABLE"
ln -sfn "$AVAILABLE" "$ENABLED"

# Avoid default site stealing Host headers when present
if [[ -L /etc/nginx/sites-enabled/default ]]; then
  echo "==> Disabling default Nginx site"
  rm -f /etc/nginx/sites-enabled/default
fi

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
  echo "==> Requesting TLS certificates"
  certbot --nginx \
    -d api.pathplus.store \
    -d admin.pathplus.store \
    --non-interactive --agree-tos --redirect \
    --register-unsafely-without-email || \
  certbot --nginx -d api.pathplus.store -d admin.pathplus.store --redirect
fi

echo ""
echo "Done. Verify DNS A records first, then test:"
echo "  curl -I http://api.pathplus.store/health"
echo "  curl -I http://admin.pathplus.store/"
echo ""
echo "DNS (at your domain registrar):"
echo "  A   api.pathplus.store     →  YOUR_VPS_IP"
echo "  A   admin.pathplus.store   →  YOUR_VPS_IP"
