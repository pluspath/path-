#!/usr/bin/env bash
# Run the admin dashboard as a system service on port 3001.
# PM2 on this server exits after every command, which kills the dashboard
# and leaves https://admin.pathplus.store as a bad gateway.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUN_BIN="$(command -v bun || true)"

if [[ ! -f "$ROOT/admin/.next/BUILD_ID" ]]; then
  echo "Dashboard build is missing. Run: cd \"$ROOT/admin\" && bun run build"
  exit 1
fi

if [[ -z "$BUN_BIN" ]]; then
  echo "bun was not found. Install Bun, then run this again."
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: bash deploy/install-admin-service.sh"
  exit 1
fi

# Do not let a broken PM2 daemon keep restarting a dead dashboard.
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete pathplus-admin >/dev/null 2>&1 || true
fi

UNIT=/etc/systemd/system/pathplus-admin.service
cat > "$UNIT" << EOF
[Unit]
Description=Path+ admin dashboard (admin.pathplus.store)
After=network.target

[Service]
Type=simple
WorkingDirectory=$ROOT/admin
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=API_INTERNAL_URL=http://127.0.0.1:3000
Environment=PATH=$(dirname "$BUN_BIN"):/usr/local/bin:/usr/bin:/bin
ExecStart=$BUN_BIN run start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable pathplus-admin
systemctl restart pathplus-admin

echo "Waiting for port 3001..."
ok=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  code="$(curl -sS -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/login 2>/dev/null || echo 000)"
  echo "  attempt $i: $code"
  if [[ "$code" == "200" || "$code" == "307" || "$code" == "308" || "$code" == "302" ]]; then
    ok=1
    break
  fi
  sleep 2
done

if [[ "$ok" != "1" ]]; then
  echo "Dashboard did not open. Last log lines:"
  systemctl status pathplus-admin --no-pager || true
  journalctl -u pathplus-admin -n 40 --no-pager || true
  exit 1
fi

echo "OK — https://admin.pathplus.store"
