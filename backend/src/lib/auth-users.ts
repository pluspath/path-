import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "../supabase";

/** Look up a Supabase Auth user by email (admin API, paginated). */
export async function findAuthUserByEmail(email: string): Promise<User | null> {
  const key = email.toLowerCase().trim();
  if (!key.includes("@")) return null;

  let page = 1;
  const perPage = 1000;

  while (page <= 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[auth-users] listUsers failed:", error.message);
      return null;
    }

    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === key);
    if (found) return found;

    if (users.length < perPage) break;
    page++;
  }

  return null;
}
