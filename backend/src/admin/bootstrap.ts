import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { supabaseAdmin } from "../supabase";
import { env } from "../env";
import { hashPassword } from "./utils/password";
import { adminUserRepository } from "./repositories/admin-user.repository";

/**
 * Ensures admin schema exists when possible (via exec_sql RPC) and seeds default admin.
 * Safe to call on every boot — all operations are idempotent.
 */
export async function bootstrapAdminSystem(): Promise<void> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("[admin] SUPABASE_SERVICE_ROLE_KEY missing — admin bootstrap skipped");
    return;
  }

  const migrationPath = resolve(process.cwd(), "migrations/001_admin_system.sql");
  if (existsSync(migrationPath)) {
    try {
      const sql = readFileSync(migrationPath, "utf8");
      // Prefer applying via RPC if available; otherwise rely on manual SQL application.
      const { error } = await supabaseAdmin.rpc("exec_sql", { sql });
      if (error) {
        console.log(
          "[admin] Could not auto-apply migration via exec_sql (apply migrations/001_admin_system.sql manually if needed):",
          error.message
        );
      } else {
        console.log("[admin] Migration applied via exec_sql");
      }
    } catch (e) {
      console.log(
        "[admin] Migration auto-apply skipped:",
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  try {
    const existing = await adminUserRepository.findByUsername("admin");
    if (!existing) {
      const password = process.env.ADMIN_DEFAULT_PASSWORD;
      if (!password || password.length < 12) {
        console.warn(
          "[admin] ADMIN_DEFAULT_PASSWORD not set (min 12 chars) — skipping default admin seed"
        );
      } else {
        const password_hash = await hashPassword(password);
        await adminUserRepository.ensureDefaultAdmin(password_hash);
        console.log("[admin] Default super_admin seeded (username: admin)");
      }
    } else {
      console.log("[admin] Default admin account present");
    }
  } catch (e: any) {
    const message = e?.message || (e instanceof Error ? e.message : JSON.stringify(e));
    console.warn(
      "[admin] Could not verify/seed admin user — run migrations/001_admin_system.sql in Supabase SQL Editor:",
      message
    );
  }
}
