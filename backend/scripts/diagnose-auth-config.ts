/**
 * Verify backend auth/email configuration without printing secrets.
 * Usage: bun run scripts/diagnose-auth-config.ts
 */
import { env } from "../src/env";
import { getEmailConfig } from "../src/lib/external-config";
import { testEmailProviderConnection } from "../src/lib/email-service";
import { supabaseAdmin } from "../src/supabase";

function present(label: string, value: string | undefined): string {
  return value?.trim() ? `${label}: present` : `${label}: MISSING`;
}

async function main() {
  console.log("Path+ auth/email configuration diagnostic\n");

  console.log(present("SUPABASE_URL", env.SUPABASE_URL));
  console.log(present("SUPABASE_ANON_KEY", env.SUPABASE_ANON_KEY));
  console.log(present("SUPABASE_SERVICE_ROLE_KEY", env.SUPABASE_SERVICE_ROLE_KEY));
  console.log(present("RESEND_API_KEY", env.RESEND_API_KEY));
  console.log(present("RESEND_FROM_EMAIL", env.RESEND_FROM_EMAIL));
  console.log("");

  const { error: supabaseError } = await supabaseAdmin
    .from("profiles")
    .select("id", { count: "exact", head: true });
  if (supabaseError) {
    console.log(`Supabase admin query: FAILED (${supabaseError.message})`);
  } else {
    console.log("Supabase admin query: OK");
  }

  const { error: listError } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });
  if (listError) {
    console.log(`Supabase auth admin listUsers: FAILED (${listError.message})`);
  } else {
    console.log("Supabase auth admin listUsers: OK");
  }

  const emailCfg = await getEmailConfig();
  console.log(`Email enabled: ${emailCfg.enabled}`);
  console.log(`Email API key source: ${emailCfg.apiKeySource}`);
  console.log(`Email from: ${emailCfg.fromEmail.replace(/@.*/, "@***")}`);

  const resendTest = await testEmailProviderConnection();
  console.log(`Resend connection: ${resendTest.ok ? "OK" : "FAILED"} — ${resendTest.message}`);

  const { error: resetTableError } = await supabaseAdmin
    .from("password_reset_otps")
    .select("email", { count: "exact", head: true });
  if (resetTableError) {
    console.log(
      `password_reset_otps table: MISSING or inaccessible (${resetTableError.message})`
    );
    console.log("  → Run migrations/014_auth_verification.sql in Supabase SQL Editor");
  } else {
    console.log("password_reset_otps table: OK");
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Diagnostic failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
