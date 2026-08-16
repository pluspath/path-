/**
 * VPS admin login diagnostics — does not use HTTP routes.
 * Usage:
 *   cd /root/path-/backend
 *   bun scripts/diag-admin.ts
 */
import { env } from "../src/env";
import { supabaseAdmin } from "../src/supabase";
import { adminUserRepository } from "../src/admin/repositories/admin-user.repository";
import { verifyPassword, hashPassword } from "../src/admin/utils/password";
import { signAdminToken } from "../src/admin/utils/jwt";

const out: Record<string, unknown> = {
  backendUrl: env.BACKEND_URL,
  nodeEnv: env.NODE_ENV ?? null,
  jwtConfigured: Boolean(env.ADMIN_JWT_SECRET && env.ADMIN_JWT_SECRET.length >= 32),
  jwtLength: env.ADMIN_JWT_SECRET?.length ?? 0,
  serviceRoleConfigured: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
  supabaseUrl: env.SUPABASE_URL,
};

try {
  const { count, error } = await supabaseAdmin
    .from("admin_users")
    .select("id", { count: "exact", head: true });
  if (error) {
    out.adminTablesOk = false;
    out.tablesMessage = error.message;
  } else {
    out.adminTablesOk = true;
    out.adminUserCount = count ?? 0;
    out.tablesMessage = "ok";
  }
} catch (e) {
  out.adminTablesOk = false;
  out.tablesMessage = e instanceof Error ? e.message : String(e);
}

try {
  const admin = await adminUserRepository.findByUsername("admin");
  out.adminUserExists = Boolean(admin);
  out.adminUserActive = admin?.is_active ?? null;
  out.adminUserRole = admin?.role ?? null;

  if (admin) {
    // Probe JWT signing (root cause of many 500s)
    try {
      const signed = await signAdminToken({
        id: admin.id,
        username: admin.username,
        role: admin.role,
      });
      out.jwtSignOk = true;
      out.jwtPreview = signed.token.slice(0, 16) + "...";
    } catch (e) {
      out.jwtSignOk = false;
      out.jwtSignError = e instanceof Error ? e.message : String(e);
    }
  }
} catch (e) {
  out.adminUserExists = false;
  out.adminLookupError = e instanceof Error ? e.message : String(e);
}

out.canLogin =
  out.jwtConfigured === true &&
  out.serviceRoleConfigured === true &&
  out.adminTablesOk === true &&
  out.adminUserExists === true &&
  out.jwtSignOk === true;

console.log(JSON.stringify(out, null, 2));

if (!out.jwtConfigured) {
  console.log("\nFIX: Add ADMIN_JWT_SECRET to .env (32+ chars), then: pm2 restart pathplus-api --update-env");
}
if (out.adminTablesOk === false) {
  console.log("\nFIX: Run migrations/001_admin_system.sql in Supabase SQL Editor");
}
if (out.adminTablesOk === true && out.adminUserExists === false) {
  console.log("\nFIX: ADMIN_DEFAULT_PASSWORD='YourStrongPass12!' bun run seed:admin");
}
if (out.jwtSignOk === false) {
  console.log("\nFIX: JWT signing failed — check ADMIN_JWT_SECRET and restart API");
}

// Optional: reset admin password if RESET_ADMIN_PASSWORD is set
const reset = process.env.RESET_ADMIN_PASSWORD;
if (reset && reset.length >= 12 && out.adminUserExists) {
  const hash = await hashPassword(reset);
  const user = await adminUserRepository.findByUsername("admin");
  if (user) {
    await adminUserRepository.update(user.id, {
      password_hash: hash,
      password_changed_at: new Date().toISOString(),
      is_active: true,
    });
    const ok = await verifyPassword(reset, hash);
    console.log(`\nPassword reset for admin: ${ok ? "OK" : "FAILED"}`);
  }
}
