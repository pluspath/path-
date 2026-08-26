import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { supabaseAdmin } from "../supabase";
import { env } from "../env";
import { hashPassword } from "./utils/password";
import { adminUserRepository } from "./repositories/admin-user.repository";

async function tryApplySqlFile(relativePath: string, label: string): Promise<void> {
  const migrationPath = resolve(process.cwd(), relativePath);
  if (!existsSync(migrationPath)) return;
  try {
    const sql = readFileSync(migrationPath, "utf8");
    const { error } = await supabaseAdmin.rpc("exec_sql", { sql });
    if (error) {
      console.log(
        `[admin] Could not auto-apply ${label} via exec_sql (apply ${relativePath} manually if needed):`,
        error.message
      );
    } else {
      console.log(`[admin] ${label} applied via exec_sql`);
    }
  } catch (e) {
    console.log(
      `[admin] ${label} auto-apply skipped:`,
      e instanceof Error ? e.message : String(e)
    );
  }
}

/**
 * Ensures admin schema exists when possible (via exec_sql RPC) and seeds default admin.
 * Safe to call on every boot — all operations are idempotent.
 */
export async function bootstrapAdminSystem(): Promise<void> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("[admin] SUPABASE_SERVICE_ROLE_KEY missing — admin bootstrap skipped");
    return;
  }

  await tryApplySqlFile("migrations/001_admin_system.sql", "Admin system migration");
  await tryApplySqlFile("migrations/002_external_services.sql", "External services migration");

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
