#!/usr/bin/env bash
# One-shot patch for VPS admin login diagnostics.
# Run from ANY cwd:
#   bash /root/path-/backend/deploy/patch-admin-ready.sh

set -euo pipefail

ROOT="${1:-/root/path-/backend}"
cd "$ROOT"

echo "==> Patching $ROOT/src/index.ts"

python3 - <<'PY'
from pathlib import Path
p = Path("src/index.ts")
text = p.read_text()

block = r'''
/** Instant admin login diagnostics (no nested routers). */
app.get("/admin-ready", async (c) => {
  let adminTablesOk = false;
  let adminUserCount: number | null = null;
  let tablesMessage = "ok";
  try {
    const { count, error } = await supabaseAdmin
      .from("admin_users")
      .select("id", { count: "exact", head: true });
    if (error) tablesMessage = error.message;
    else {
      adminTablesOk = true;
      adminUserCount = count ?? 0;
    }
  } catch (e) {
    tablesMessage = e instanceof Error ? e.message : String(e);
  }

  const jwtConfigured = Boolean(env.ADMIN_JWT_SECRET && env.ADMIN_JWT_SECRET.length >= 32);
  const serviceRoleConfigured = Boolean(env.SUPABASE_SERVICE_ROLE_KEY);

  return c.json({
    data: {
      jwtConfigured,
      serviceRoleConfigured,
      adminTablesOk,
      adminUserCount,
      tablesMessage,
      backendUrl: env.BACKEND_URL,
      canLogin:
        jwtConfigured && serviceRoleConfigured && adminTablesOk && (adminUserCount ?? 0) > 0,
    },
  });
});

'''

if 'app.get("/admin-ready"' in text:
    print("admin-ready already present")
else:
    marker = 'app.get("/health", (c) => c.json({ status: "ok" }));'
    if marker not in text:
        raise SystemExit("Could not find /health marker in src/index.ts")
    text = text.replace(marker, marker + "\n" + block, 1)
    p.write_text(text)
    print("inserted /admin-ready")

# Ensure JWT secret
env = Path(".env")
if env.exists():
    lines = env.read_text().splitlines()
    has = any(l.startswith("ADMIN_JWT_SECRET=") and len(l.split("=",1)[-1].strip()) >= 32 for l in lines)
    if not has:
        import secrets
        lines = [l for l in lines if not l.startswith("ADMIN_JWT_SECRET=")]
        lines.append("ADMIN_JWT_SECRET=" + secrets.token_hex(48))
        env.write_text("\n".join(lines) + "\n")
        print("wrote ADMIN_JWT_SECRET")
    # force https backend url
    out = []
    for l in lines if 'lines' in dir() else env.read_text().splitlines():
        pass
    lines = env.read_text().splitlines()
    changed = False
    new = []
    for l in lines:
        if l.startswith("BACKEND_URL=http://"):
            new.append("BACKEND_URL=https://api.pathplus.store")
            changed = True
        else:
            new.append(l)
    if changed:
        env.write_text("\n".join(new) + "\n")
        print("updated BACKEND_URL to https")
else:
    print("WARNING: .env missing")
PY

echo "==> Force recreate PM2 process"
pm2 delete pathplus-api >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs --only pathplus-api
pm2 save
sleep 2

echo "==> Tests"
echo -n "health: "; curl -sS http://127.0.0.1:3000/health; echo
echo -n "admin-ready: "; curl -sS http://127.0.0.1:3000/admin-ready; echo
echo
echo "If admin-ready is still 404, PM2 is not running this folder. Run:"
echo "  pm2 show pathplus-api"
echo "  head -n 5 /proc/\$(pm2 pid pathplus-api)/cwd 2>/dev/null || readlink /proc/\$(pm2 pid pathplus-api)/cwd"
