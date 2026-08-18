#!/usr/bin/env bash
# Put api.pathplus.store on the Hono API (:3000) and admin on Next (:3001).
# Fixes the case where api.pathplus.store accidentally serves the admin HTML app.
#
#   sudo bash deploy/fix-api-nginx.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF_SRC="$ROOT/deploy/nginx.pathplus.conf"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/fix-api-nginx.sh"
  exit 1
fi

if [[ ! -f "$CONF_SRC" ]]; then
  echo "Missing $CONF_SRC"
  exit 1
fi

if [[ ! -f /etc/letsencrypt/live/api.pathplus.store/fullchain.pem ]]; then
  echo "TLS cert missing at /etc/letsencrypt/live/api.pathplus.store/"
  echo "Run: sudo bash deploy/nginx-setup.sh --ssl"
  exit 1
fi

echo "==> Local ports"
curl -sS -m 5 http://127.0.0.1:3000/health || echo "(API :3000 not answering)"
echo
curl -sS -m 5 -o /dev/null -w "admin :3001 HTTP %{http_code}\n" http://127.0.0.1:3001/ || true

echo "==> Installing corrected Nginx site"
cp "$CONF_SRC" /etc/nginx/sites-available/pathplus
ln -sfn /etc/nginx/sites-available/pathplus /etc/nginx/sites-enabled/pathplus

# Remove duplicates that steal api.pathplus.store
for old in pathplus-api pathplus-admin default; do
  rm -f "/etc/nginx/sites-enabled/$old"
done

# Any leftover file whose server_name is only api but proxies to 3001
shopt -s nullglob
for f in /etc/nginx/sites-enabled/*; do
  base="$(basename "$f")"
  [[ "$base" == "pathplus" ]] && continue
  if grep -q 'server_name api.pathplus.store' "$f" 2>/dev/null; then
    echo "==> Disabling duplicate $base (also claims api.pathplus.store)"
    rm -f "$f"
  fi
done

nginx -t
systemctl reload nginx

echo
echo "==> Public API (must be JSON, not HTML)"
echo -n "https://api.pathplus.store/health => "
curl -sS -m 10 https://api.pathplus.store/health
echo
echo -n "https://api.pathplus.store/api/config => "
curl -sS -m 10 -o /tmp/pathplus-config.json -w "%{http_code}" https://api.pathplus.store/api/config
echo
head -c 180 /tmp/pathplus-config.json; echo

if grep -q '<html' /tmp/pathplus-config.json 2>/dev/null; then
  echo
  echo "STILL HTML — api.pathplus.store is not reaching :3000."
  echo "Check: pm2 status && ss -lptn | grep -E '3000|3001'"
  exit 1
fi

echo
echo "OK. Mobile app should use https://api.pathplus.store"
