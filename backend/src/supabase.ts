import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

// Base client with anon key for auth verification
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Admin client using service role key — bypasses RLS for storage operations
// Falls back to anon key if service role key is not configured (will likely fail for storage)
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("[supabase] SUPABASE_SERVICE_ROLE_KEY not set — storage uploads may fail. Add it via the ENV tab.");
}
export const supabaseAdmin = createClient(env.SUPABASE_URL, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Create a user-scoped client that activates RLS with the user's JWT
export function createUserClient(accessToken: string) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Best available client for reading data that belongs to the signed-in user.
 *
 * With a service role key configured this is just `supabaseAdmin`. Without one,
 * `supabaseAdmin` silently degrades to the anon key, which RLS blocks — every
 * query then comes back empty and the feature looks broken for no visible
 * reason. Falling back to the user's own JWT keeps those reads working, since
 * RLS grants a user access to their own rows anyway.
 */
export function adminOrUser(accessToken: string) {
  return env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : createUserClient(accessToken);
}
