/**
 * End-to-end sign-up test (same flow as the mobile app).
 * Usage: bun run scripts/test-signup.ts
 */
const BACKEND = process.env.BACKEND_URL ?? "https://api.pathplus.store";
const ts = Date.now();
const testUser = {
  fullName: "Test User",
  username: `testuser_${ts}`,
  email: `pathplus.test.${ts}@mailinator.com`,
  password: "TestPass123!",
};

async function request(path: string, init?: RequestInit) {
  const res = await fetch(`${BACKEND}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function main() {
  console.log("Sign-up flow test\n");
  console.log(`Backend: ${BACKEND}`);
  console.log(`Test email: ${testUser.email}`);
  console.log(`Test username: ${testUser.username}\n`);

  console.log("1. Username check...");
  const check = await request(`/api/username-check/${testUser.username}`);
  if (!check.res.ok) {
    console.log(`✗ Failed (${check.res.status}):`, check.json);
    process.exit(1);
  }
  console.log(`✓ Username available: ${check.json?.data?.available ?? check.json}\n`);

  console.log("2. Sign up...");
  const signup = await request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(testUser),
  });

  if (!signup.res.ok || signup.json?.error) {
    console.log(`✗ Sign up failed (${signup.res.status}):`, signup.json?.error?.message ?? signup.json);
    process.exit(1);
  }
  console.log("✓ Sign up succeeded:", signup.json?.data?.message ?? signup.json);

  console.log("\n3. Verify NO active account exists before OTP...");
  const url = process.env.SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (url && service) {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(url, service, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: profile } = await admin
      .from("profiles")
      .select("id, username, full_name")
      .eq("username", testUser.username)
      .maybeSingle();
    if (profile) {
      console.log("✗ Profile should NOT exist before OTP verification:", profile);
      process.exit(1);
    }
    const { data: pending } = await admin
      .from("pending_registrations")
      .select("email, username")
      .eq("email", testUser.email)
      .maybeSingle();
    if (pending) {
      console.log("✓ Pending registration stored (account not created yet):", pending);
    } else {
      console.log("⚠ pending_registrations row not found — run migration 014 or restart backend for boot DDL");
    }
  }

  console.log("\nNext step in app: enter the 6-digit OTP sent to the email.");
  console.log("(OTP verification requires the email from Resend.)");
}

main().catch((err) => {
  console.error("✗ Unexpected error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
