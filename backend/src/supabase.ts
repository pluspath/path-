import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

const SUPABASE_FETCH_TIMEOUT_MS = 8_000;

/** Fail fast when Supabase is unreachable instead of hanging request handlers. */
async function supabaseFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS);

  const parentSignal = init?.signal;
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

const clientOptions = {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: supabaseFetch as typeof fetch },
};

// Base client with anon key for auth verification
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, clientOptions);

// Admin client using service role key — bypasses RLS for storage operations
// Falls back to anon key if service role key is not configured (will likely fail for storage)
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("[supabase] SUPABASE_SERVICE_ROLE_KEY not set — storage uploads may fail. Add it via the ENV tab.");
}
export const supabaseAdmin = createClient(env.SUPABASE_URL, serviceKey, clientOptions);

// Create a user-scoped client that activates RLS with the user's JWT
export function createUserClient(accessToken: string) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    ...clientOptions,
    global: {
      ...clientOptions.global,
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}
