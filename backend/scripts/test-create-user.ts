import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ts = Date.now();
const email = `pathplus.direct.${ts}@mailinator.com`;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await admin.auth.admin.createUser({
  email,
  password: "TestPass123!",
  email_confirm: true,
  user_metadata: { full_name: "Direct Test", username: `direct_${ts}` },
});

if (error) {
  console.log("✗ createUser failed:", error.message);
  process.exit(1);
}

console.log("✓ Auth user created:", data.user?.id, data.user?.email);

const userId = data.user!.id;
const { error: profileError } = await admin.from("profiles").upsert(
  { id: userId, username: `direct_${ts}`, full_name: "Direct Test" },
  { onConflict: "id" },
);

if (profileError) {
  console.log("✗ Profile upsert failed:", profileError.message);
  process.exit(1);
}

console.log("✓ Profile created in Supabase");
console.log("\nTest account (for manual sign-in):");
console.log("  Email:", email);
console.log("  Password: TestPass123!");
