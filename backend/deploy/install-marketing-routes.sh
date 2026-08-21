#!/usr/bin/env bash
# Install marketing routes from deploy/marketing-files.tar.gz then restart API.
#
# From your PC (PowerShell), copy the tarball + this script:
#   scp deploy/marketing-files.tar.gz deploy/install-marketing-routes.sh root@YOUR_VPS:/root/path-/backend/deploy/
#
# On the VPS:
#   cd /root/path-/backend
#   bash deploy/install-marketing-routes.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
TAR="$ROOT/deploy/marketing-files.tar.gz"

echo "==> Backend: $ROOT"

if [[ ! -f "$TAR" ]]; then
  echo "Missing $TAR"
  echo "Copy it from your PC, then re-run this script."
  exit 1
fi

echo "==> Extracting marketing source files"
tar -xzf "$TAR" -C "$ROOT"

for f in \
  src/lib/markdown-html.ts \
  src/lib/legal-seed.ts \
  src/lib/marketing-site.ts \
  src/routes/content.ts
do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: $f missing after extract"
    exit 1
  fi
  echo "  ok $f"
done

if ! grep -q 'legalPagesRouter' src/index.ts; then
  echo "==> Patching src/index.ts to mount marketing routes"
  bun <<'BUN'
import { readFileSync, writeFileSync } from "fs";
const path = "src/index.ts";
let s = readFileSync(path, "utf8");
if (!s.includes("legalPagesRouter")) {
  if (s.includes('from "./routes/blocks"')) {
    s = s.replace(
      'from "./routes/blocks";',
      'from "./routes/blocks";\nimport { contentRouter, legalPagesRouter, seedLegalContent } from "./routes/content";'
    );
  } else if (s.includes("from './routes/blocks'")) {
    s = s.replace(
      "from './routes/blocks';",
      "from './routes/blocks';\nimport { contentRouter, legalPagesRouter, seedLegalContent } from './routes/content';"
    );
  } else {
    s = 'import { contentRouter, legalPagesRouter, seedLegalContent } from "./routes/content";\n' + s;
  }

  if (s.includes("bootstrapAdminSystem()") && !s.includes("seedLegalContent()")) {
    s = s.replace(
      "bootstrapAdminSystem().catch",
      "bootstrapAdminSystem().then(() => seedLegalContent()).catch"
    );
  }

  if (!s.includes('app.route("/", legalPagesRouter)')) {
    if (s.includes('app.route("/api/config"')) {
      s = s.replace(
        'app.route("/api/config"',
        'app.route("/", legalPagesRouter);\napp.route("/api/content", contentRouter);\napp.route("/api/config"'
      );
    } else {
      s += '\napp.route("/", legalPagesRouter);\napp.route("/api/content", contentRouter);\n';
    }
  }
  writeFileSync(path, s);
  console.log("patched src/index.ts");
}
BUN
else
  echo "==> src/index.ts already has legalPagesRouter"
fi

echo "==> Restarting API"
pm2 restart pathplus-api --update-env || pm2 restart ecosystem.config.cjs --update-env
pm2 save || true
sleep 2

echo "==> Smoke test (expect 200)"
fail=0
for p in / /support /privacy /terms; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000$p" || echo err)
  echo "  $p -> $code"
  if [[ "$code" != "200" ]]; then fail=1; fi
done

if [[ "$fail" -ne 0 ]]; then
  echo ""
  echo "Still not 200. Check PM2 logs:"
  echo "  pm2 logs pathplus-api --lines 80"
  exit 1
fi

echo ""
echo "Success. Open:"
echo "  https://api.pathplus.store/"
echo "  https://api.pathplus.store/support"
echo "  https://api.pathplus.store/privacy"
echo "  https://www.pathplus.store/support"
