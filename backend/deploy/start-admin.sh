#!/usr/bin/env bash
# Production start for the admin dashboard (port 3001).
# PM2's default PATH often cannot see Bun, and running the Next.js
# binary through `interpreter: bun` exits immediately.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/admin"

export PATH="${BUN_INSTALL:-$HOME/.bun}/bin:/usr/local/bin:/usr/bin:$PATH"
export NODE_ENV=production
export PORT=3001
export API_INTERNAL_URL="${API_INTERNAL_URL:-http://127.0.0.1:3000}"

if [[ ! -f .next/BUILD_ID ]]; then
  echo "admin/.next is missing. From the backend folder run: cd admin && bun run build" >&2
  exit 1
fi

if [[ -x /usr/bin/node ]]; then
  exec /usr/bin/node ./node_modules/next/dist/bin/next start -p 3001 -H 0.0.0.0
fi
if [[ -x /usr/local/bin/node ]]; then
  exec /usr/local/bin/node ./node_modules/next/dist/bin/next start -p 3001 -H 0.0.0.0
fi
if command -v node >/dev/null 2>&1; then
  exec node ./node_modules/next/dist/bin/next start -p 3001 -H 0.0.0.0
fi

exec bun run start
