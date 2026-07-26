/**
 * Applies admin migrations.
 *
 * Preferred: set DATABASE_URL (Supabase Postgres URI) in .env
 * Fallback: exec_sql RPC (if created via migrations/000_exec_sql_helper.sql)
 *
 * Usage: bun run migrate:admin
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import postgres from "postgres";
import { supabaseAdmin } from "../src/supabase";

const files = [
  "migrations/000_exec_sql_helper.sql",
  "migrations/001_admin_system.sql",
  "migrations/002_user_preferences.sql",
  "migrations/003_posts_location_coords.sql",
  "migrations/004_rls_policies.sql",
  "migrations/005_storage_buckets.sql",
];

async function applyViaDatabaseUrl(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 1, ssl: "require" });
  try {
    for (const file of files) {
      const path = resolve(process.cwd(), file);
      const body = readFileSync(path, "utf8");
      console.log(`[migrate] Applying ${file} via DATABASE_URL…`);
      await sql.unsafe(body);
      console.log(`[migrate] OK ${file}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function applyViaRpc() {
  for (const file of files) {
    const path = resolve(process.cwd(), file);
    const body = readFileSync(path, "utf8");
    console.log(`[migrate] Applying ${file} via exec_sql RPC…`);
    const { error } = await supabaseAdmin.rpc("exec_sql", { sql: body });
    if (error) throw error;
    console.log(`[migrate] OK ${file}`);
  }
}

const databaseUrl = process.env.DATABASE_URL;

try {
  if (databaseUrl) {
    await applyViaDatabaseUrl(databaseUrl);
  } else {
    console.log("[migrate] DATABASE_URL not set — trying exec_sql RPC…");
    await applyViaRpc();
  }
  console.log("[migrate] All admin migrations applied.");
} catch (e: any) {
  console.error("[migrate] Failed:", e?.message || e);
  console.error("");
  console.error("Manual steps:");
  console.error("1) Open Supabase → SQL Editor");
  console.error("2) Run migrations/000_exec_sql_helper.sql (optional)");
  console.error("3) Run migrations/001_admin_system.sql (required)");
  console.error("Or set DATABASE_URL in .env and re-run: bun run migrate:admin");
  process.exit(1);
}
