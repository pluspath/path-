/**
 * One-shot: add profiles.gender (+ related columns) for GenderGate / signup.
 * Usage: bun run scripts/apply-gender-column.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { supabaseAdmin } from "../src/supabase";

const statements = [
  "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gender TEXT",
  "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birthday TEXT",
  "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS show_age BOOLEAN DEFAULT FALSE",
  "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS show_zodiac BOOLEAN DEFAULT FALSE",
  "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username_changed BOOLEAN DEFAULT FALSE",
  "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_token TEXT",
];

async function main() {
  console.log("[migrate] Adding profile gender columns…");

  // Prefer full migration file if exec_sql can run multi-statement SQL
  const full = readFileSync(resolve("migrations/008_profile_gender.sql"), "utf8");
  const { error: fullError } = await supabaseAdmin.rpc("exec_sql", { sql: full });
  if (!fullError) {
    console.log("[migrate] OK via 008_profile_gender.sql");
    return;
  }

  console.warn("[migrate] Full file failed:", fullError.message);
  console.log("[migrate] Trying statement-by-statement…");

  let failed = 0;
  for (const sql of statements) {
    const { error } = await supabaseAdmin.rpc("exec_sql", { sql });
    if (error) {
      failed += 1;
      console.error(`  FAIL: ${sql}`);
      console.error(`        ${error.message}`);
    } else {
      console.log(`  OK: ${sql}`);
    }
  }

  if (failed > 0) {
    console.error("");
    console.error("Could not apply all statements via exec_sql.");
    console.error("Open Supabase → SQL Editor and run migrations/008_profile_gender.sql");
    process.exit(1);
  }

  console.log("[migrate] OK — gender columns ready");
}

main();
