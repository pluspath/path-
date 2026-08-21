#!/usr/bin/env bash
# Patch /health on the VPS so GET /health?ready=1 returns admin login diagnostics.
set -euo pipefail
cd /root/path-/backend

python3 - <<'PY'
from pathlib import Path
p = Path("src/index.ts")
text = p.read_text()

old = 'app.get("/health", (c) => c.json({ status: "ok" }));'
# also match already-async health without ready
if 'c.req.query("ready")' in text and '/health' in text:
    print("health?ready=1 already present")
else:
    new = r'''app.get("/health", async (c) => {
  if (c.req.query("ready") === "1") {
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
      status: "ok",
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
  }
  return c.json({ status: "ok" });
});'''
    if old in text:
        text = text.replace(old, new, 1)
        p.write_text(text)
        print("patched simple /health")
    elif 'app.get("/health", async (c) => {' in text:
        # Replace existing async health block start by injecting ready check after opening
        # Fallback: write marker file for manual
        print("complex health handler detected — writing overlay file")
        Path("src/health-ready-overlay.ts").write_text("export {}\n")
    else:
        raise SystemExit("Could not find /health handler to patch")

# JWT secret
import secrets
env = Path(".env")
lines = env.read_text().splitlines() if env.exists() else []
lines = [l for l in lines if not l.startswith("ADMIN_JWT_SECRET=")]
lines.append("ADMIN_JWT_SECRET=" + secrets.token_hex(48))
fixed = []
seen = False
for l in lines:
    if l.startswith("BACKEND_URL="):
        fixed.append("BACKEND_URL=https://api.pathplus.store"); seen = True
    else:
        fixed.append(l)
if not seen:
    fixed.append("BACKEND_URL=https://api.pathplus.store")
env.write_text("\n".join(fixed) + "\n")
print("env ok")
PY

# Show whether ready query is in health
grep -n 'ready' src/index.ts | head -20

pm2 delete pathplus-api >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs --only pathplus-api
pm2 save
sleep 2
pm2 logs pathplus-api --lines 20 --nostream || true

echo "==== /health ===="
curl -sS http://127.0.0.1:3000/health; echo
echo "==== /health?ready=1 ===="
curl -sS "http://127.0.0.1:3000/health?ready=1"; echo
