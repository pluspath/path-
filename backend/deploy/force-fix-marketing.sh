#!/usr/bin/env bash
# Force-fix marketing routes when files exist but smoke tests still 404.
# Run on VPS:
#   cd /root/path-/backend
#   bash deploy/force-fix-marketing.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "==> Backend: $ROOT"

echo "==> PM2 process info"
pm2 show pathplus-api | sed -n '1,60p' || true

echo ""
echo "==> index.ts route lines"
grep -n "legalPagesRouter\|contentRouter\|app.route\|seedLegalContent" src/index.ts || true

echo ""
echo "==> Import check"
if ! bun -e 'import { legalPagesRouter, contentRouter } from "./src/routes/content.ts"; console.log("import ok", !!legalPagesRouter, !!contentRouter)'; then
  echo "IMPORT FAILED — content.ts or deps broken. Showing error above."
  pm2 logs pathplus-api --lines 40 --nostream || true
  exit 1
fi

echo ""
echo "==> Rewriting mounts in src/index.ts (idempotent)"
bun <<'BUN'
import { readFileSync, writeFileSync } from "fs";

const path = "src/index.ts";
let s = readFileSync(path, "utf8");

// Ensure import exists exactly once
s = s.replace(
  /^\s*import\s*\{[^}]*legalPagesRouter[^}]*\}\s*from\s*["']\.\/routes\/content["'];?\s*$/gm,
  ""
);
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
} else if (!s.includes('from "./routes/content"') && !s.includes("from './routes/content'")) {
  s = 'import { contentRouter, legalPagesRouter, seedLegalContent } from "./routes/content";\n' + s;
}

// Remove existing marketing mounts to avoid duplicates
s = s.replace(/^\s*app\.route\(\s*["']\/["']\s*,\s*legalPagesRouter\s*\)\s*;?\s*$/gm, "");
s = s.replace(/^\s*app\.route\(\s*["']\/api\/content["']\s*,\s*contentRouter\s*\)\s*;?\s*$/gm, "");

const mountBlock =
  'app.route("/", legalPagesRouter);\napp.route("/api/content", contentRouter);\n';

if (s.includes('app.route("/api/config"')) {
  s = s.replace('app.route("/api/config"', mountBlock + 'app.route("/api/config"');
} else if (s.includes("app.route('/api/config'")) {
  s = s.replace("app.route('/api/config'", mountBlock + "app.route('/api/config'");
} else if (s.includes('app.get("/health"')) {
  // mount after health block end is hard; append before export default if present
  if (s.includes("export default")) {
    s = s.replace("export default", mountBlock + "\nexport default");
  } else {
    s += "\n" + mountBlock;
  }
} else {
  s += "\n" + mountBlock;
}

// Ensure seed hook
if (s.includes("bootstrapAdminSystem()") && !s.includes("seedLegalContent()")) {
  s = s.replace(
    "bootstrapAdminSystem().catch",
    "bootstrapAdminSystem().then(() => seedLegalContent()).catch"
  );
}

writeFileSync(path, s);
console.log("wrote", path);
BUN

echo ""
echo "==> Confirm mounts"
grep -n "legalPagesRouter\|contentRouter\|app.route(\"/\"" src/index.ts || true

echo ""
echo "==> Restart with updated env + clear bun cache hint"
rm -rf node_modules/.cache 2>/dev/null || true
pm2 delete pathplus-api || true
# Prefer ecosystem if present; fallback to direct start from this ROOT
if [[ -f ecosystem.config.cjs ]]; then
  pm2 start ecosystem.config.cjs --only pathplus-api --update-env
else
  pm2 start src/index.ts --name pathplus-api --interpreter bun --update-env
fi
pm2 save || true
sleep 3

echo ""
echo "==> Recent logs"
pm2 logs pathplus-api --lines 30 --nostream || true

echo ""
echo "==> Smoke test"
fail=0
for p in / /support /privacy /terms /health; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000$p" || echo err)
  echo "  $p -> $code"
  if [[ "$p" != "/health" && "$code" != "200" ]]; then fail=1; fi
done

if [[ "$fail" -ne 0 ]]; then
  echo ""
  echo "Still failing. Paste output of:"
  echo "  pm2 show pathplus-api"
  echo "  grep -n legalPagesRouter src/index.ts"
  echo "  pm2 logs pathplus-api --lines 100 --nostream"
  exit 1
fi

echo ""
echo "Success:"
echo "  https://api.pathplus.store/"
echo "  https://api.pathplus.store/support"
echo "  https://www.pathplus.store/support"
