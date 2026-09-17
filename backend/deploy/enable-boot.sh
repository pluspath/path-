#!/usr/bin/env bash
# Make Path+ survive a full VPS reboot:
#   - nginx starts via systemd
#   - pathplus-api (:3000) + pathplus-admin (:3001) start via PM2
#
# Run once on the VPS (as root):
#   cd /root/path-/backend
#   sed -i 's/\r$//' deploy/enable-boot.sh
#   bash deploy/enable-boot.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/enable-boot.sh"
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: pm2 not installed. Run: npm i -g pm2"
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "ERROR: bun not installed."
  exit 1
fi

echo "==> Backend: $ROOT"

# ── 1) Nginx on boot ───────────────────────────────────────────────
if command -v systemctl >/dev/null 2>&1; then
  echo "==> Enable nginx on boot"
  systemctl enable nginx >/dev/null 2>&1 || true
  systemctl start nginx >/dev/null 2>&1 || true
  systemctl is-enabled nginx 2>/dev/null || echo "  (nginx enable skipped / not installed)"
fi

# ── 2) Ensure both apps are in PM2 ─────────────────────────────────
echo "==> Ensure pathplus-api + pathplus-admin are running"

if [[ ! -f ecosystem.config.cjs ]]; then
  echo "ERROR: missing ecosystem.config.cjs in $ROOT"
  exit 1
fi

# Admin needs a production build to start
if [[ ! -f admin/.next/BUILD_ID ]]; then
  echo "==> Building admin (required before first start)"
  bun install --cwd admin
  ( cd admin && bun run build )
fi

if pm2 describe pathplus-api >/dev/null 2>&1 && pm2 describe pathplus-admin >/dev/null 2>&1; then
  pm2 restart ecosystem.config.cjs --update-env
else
  # Drop stale single-app entries, then start both cleanly
  pm2 delete pathplus-api >/dev/null 2>&1 || true
  pm2 delete pathplus-admin >/dev/null 2>&1 || true
  pm2 start ecosystem.config.cjs --update-env
fi

# ── 3) Persist process list ────────────────────────────────────────
echo "==> Save PM2 process list"
pm2 save --force

# ── 4) Install systemd unit so PM2 restores apps on reboot ─────────
echo "==> Install PM2 startup (systemd)"
# Detect the real user that owns the PM2 dump (usually root on this VPS)
PM2_USER="${SUDO_USER:-root}"
if [[ "$PM2_USER" == "root" ]] || [[ "$(id -u)" -eq 0 && -z "${SUDO_USER:-}" ]]; then
  PM2_USER="root"
  PM2_HOME="/root"
else
  PM2_HOME="$(getent passwd "$PM2_USER" | cut -d: -f6)"
fi

# Generate and apply the startup command (do not only print it)
STARTUP_CMD="$(pm2 startup systemd -u "$PM2_USER" --hp "$PM2_HOME" | tail -n 1)"
echo "  running: $STARTUP_CMD"
# shellcheck disable=SC2086
eval $STARTUP_CMD

# Save again after startup registration
pm2 save --force

# ── 5) Verify ──────────────────────────────────────────────────────
echo
echo "==> PM2 status"
pm2 status

echo
echo "==> Boot services"
systemctl is-enabled nginx 2>/dev/null || true
systemctl is-enabled "pm2-${PM2_USER}" 2>/dev/null \
  || systemctl is-enabled pm2-root 2>/dev/null \
  || systemctl list-unit-files 'pm2*' 2>/dev/null | head -20 || true

echo
echo -n "local API   :3000 -> "
curl -sS -m 5 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/health || echo "DOWN"
echo -n "local Admin :3001 -> "
curl -sS -m 5 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/ || echo "DOWN"

echo
echo "OK — after reboot, nginx + API + Admin should come back automatically."
echo
echo "Optional test (reboots the VPS):"
echo "  reboot"
echo "  # wait ~1–2 min, then:"
echo "  pm2 status"
echo "  curl -I https://api.pathplus.store/health"
echo "  curl -I https://admin.pathplus.store/"
