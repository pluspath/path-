import type { User } from "@supabase/supabase-js";
import { env } from "../env";
import { supabaseAdmin } from "../supabase";

export type AuthUserRef = { id: string; email?: string | null };

export type FindAuthUserResult =
  | { ok: true; user: AuthUserRef | null }
  | { ok: false; reason: "supabase_config" | "unknown" };

function isSupabaseKeyError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    /invalid api key|api key is invalid|jwt|unauthorized|invalid claim|service role/.test(
      lower
    )
  );
}

const LOOKUP_FN = "auth_user_id_by_email";

const LOOKUP_FN_SQL = `
CREATE OR REPLACE FUNCTION public.auth_user_id_by_email(target_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, public
AS $$ SELECT id FROM auth.users WHERE lower(email) = lower(target_email) LIMIT 1 $$
`;

let lookupFnReady: boolean | null = null;

async function ensureLookupFunction(): Promise<boolean> {
  if (lookupFnReady === true) return true;
  const { error } = await supabaseAdmin.rpc("exec_sql", { sql: LOOKUP_FN_SQL });
  if (error) {
    lookupFnReady = false;
    return false;
  }
  await supabaseAdmin.rpc("exec_sql", {
    sql: "REVOKE ALL ON FUNCTION public.auth_user_id_by_email(text) FROM PUBLIC",
  });
  await supabaseAdmin.rpc("exec_sql", {
    sql: "REVOKE ALL ON FUNCTION public.auth_user_id_by_email(text) FROM anon",
  });
  await supabaseAdmin.rpc("exec_sql", {
    sql: "REVOKE ALL ON FUNCTION public.auth_user_id_by_email(text) FROM authenticated",
  });
  lookupFnReady = true;
  return true;
}

async function lookupViaRpc(email: string): Promise<FindAuthUserResult | null> {
  const ready = await ensureLookupFunction();
  if (!ready) return null;

  const { data, error } = await supabaseAdmin.rpc(LOOKUP_FN, { target_email: email });
  if (error) {
    console.warn("[auth-users] rpc lookup failed:", error.message);
    if (isSupabaseKeyError(error.message)) {
      return { ok: false, reason: "supabase_config" };
    }
    lookupFnReady = false;
    return null;
  }

  const id = typeof data === "string" && data.length > 0 ? data : null;
  return { ok: true, user: id ? { id, email } : null };
}

/**
 * One GoTrue request. Newer Auth servers honor `filter` as an email search.
 * A full page of unrelated users means the server ignored the filter.
 */
async function lookupViaAdminFilter(email: string): Promise<FindAuthUserResult | "unsupported" | null> {
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const base = env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!serviceKey || !base) return { ok: false, reason: "supabase_config" };

  const url = new URL(`${base}/auth/v1/admin/users`);
  url.searchParams.set("page", "1");
  url.searchParams.set("per_page", "5");
  url.searchParams.set("filter", email);

  try {
    const res = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: "supabase_config" };
      }
      console.warn("[auth-users] filtered list failed:", res.status, text.slice(0, 160));
      return null;
    }
    const json = (await res.json()) as { users?: User[] } | User[];
    const users = Array.isArray(json) ? json : (json.users ?? []);
    const found = users.find((u) => u.email?.toLowerCase() === email);
    if (found?.id) return { ok: true, user: { id: found.id, email: found.email } };
    if (users.length < 5) return { ok: true, user: null };
    return "unsupported";
  } catch (e) {
    console.warn(
      "[auth-users] filtered list error:",
      e instanceof Error ? e.message : "unknown"
    );
    return null;
  }
}

/**
 * Look up a Supabase Auth user by email.
 * Must stay to one or two requests — paging every user makes signup exceed
 * the phone's network timeout after the verification email has already been sent.
 */
export async function findAuthUserByEmail(email: string): Promise<FindAuthUserResult> {
  const key = email.toLowerCase().trim();
  if (!key.includes("@")) return { ok: true, user: null };

  const viaRpc = await lookupViaRpc(key);
  if (viaRpc) return viaRpc;

  const viaFilter = await lookupViaAdminFilter(key);
  if (viaFilter && viaFilter !== "unsupported") return viaFilter;

  // Last resort: a single page, never a full scan.
  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) {
      console.error("[auth-users] listUsers failed:", error.message);
      if (isSupabaseKeyError(error.message)) return { ok: false, reason: "supabase_config" };
      return { ok: false, reason: "unknown" };
    }
    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === key);
    if (found?.id) return { ok: true, user: { id: found.id, email: found.email } };
    if (users.length < 200) return { ok: true, user: null };
    console.error("[auth-users] email lookup could not scan the full directory");
    return { ok: false, reason: "unknown" };
  } catch (e) {
    console.error("[auth-users] listUsers threw:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "unknown" };
  }
}
