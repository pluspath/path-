import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function ok(label: string, detail?: string) {
  console.log(`✓ ${label}${detail ? `: ${detail}` : ""}`);
}

function fail(label: string, detail?: string) {
  console.log(`✗ ${label}${detail ? `: ${detail}` : ""}`);
}

async function testTable(client: ReturnType<typeof createClient>, label: string) {
  const { error, count } = await client
    .from("profiles")
    .select("id", { count: "exact", head: true });

  if (error) {
    fail(label, error.message);
    return false;
  }

  ok(label, `profiles reachable (${count ?? 0} rows)`);
  return true;
}

async function main() {
  console.log("Supabase connection test\n");

  if (!url || !anonKey) {
    fail("Environment", "SUPABASE_URL and SUPABASE_ANON_KEY are required");
    process.exit(1);
  }

  ok("Project URL", url);

  const anon = createClient(url, anonKey);
  const anonOk = await testTable(anon, "Anon key (mobile app)");

  if (!serviceKey) {
    fail("Service role key", "SUPABASE_SERVICE_ROLE_KEY not set (backend admin tasks may fail)");
  } else {
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await testTable(admin, "Service role key (backend)");
  }

  process.exit(anonOk ? 0 : 1);
}

main().catch((err: unknown) => {
  fail("Unexpected error", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
