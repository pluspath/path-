import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "../supabase";

export type FindAuthUserResult =
  | { ok: true; user: User | null }
  | { ok: false; reason: "supabase_config" | "unknown" };

function isSupabaseKeyError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    /invalid api key|api key is invalid|jwt|unauthorized|invalid claim|service role/.test(
      lower
    )
  );
}

/** Look up a Supabase Auth user by email (admin API, paginated). */
export async function findAuthUserByEmail(email: string): Promise<FindAuthUserResult> {
  const key = email.toLowerCase().trim();
  if (!key.includes("@")) return { ok: true, user: null };

  let page = 1;
  const perPage = 1000;

  while (page <= 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[auth-users] listUsers failed:", error.message);
      if (isSupabaseKeyError(error.message)) {
        return { ok: false, reason: "supabase_config" };
      }
      return { ok: false, reason: "unknown" };
    }

    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === key);
    if (found) return { ok: true, user: found };

    if (users.length < perPage) break;
    page++;
  }

  return { ok: true, user: null };
}
