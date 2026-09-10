import { supabaseAdmin } from "../supabase";

// Explicit FK hints — after `repath_of`, bare `profiles(*)` is ambiguous.
export const POST_SELECT =
  "*, profiles!user_id(*), reactions(user_id, type, profiles!user_id(avatar_url))";
export const POST_SELECT_BASIC = "*, profiles!user_id(*)";
export const POST_SELECT_MIN = "*";

/**
 * Load posts with the service-role client (bypasses RLS). Privacy is enforced
 * in route handlers. Nested embeds can fail after schema-cache lag; we fall back.
 */
export async function loadPosts(
  build: (select: string) => any
): Promise<{ data: any[]; error: any | null }> {
  const attempts = [POST_SELECT, POST_SELECT_BASIC, POST_SELECT_MIN];
  let lastError: any = null;
  for (const select of attempts) {
    const { data, error } = await build(select);
    if (!error) {
      const rows = data ?? [];
      if (select === POST_SELECT_MIN && rows.length > 0 && !rows[0]?.profiles) {
        await hydratePostProfiles(rows);
      }
      return { data: rows, error: null };
    }
    lastError = error;
    console.warn(`[posts] select failed:`, error.message);
  }
  return { data: [], error: lastError };
}

export async function hydratePostProfiles(posts: any[]): Promise<void> {
  const ids = Array.from(new Set(posts.map((p) => p?.user_id).filter(Boolean)));
  if (ids.length === 0) return;
  const { data: profiles } = await supabaseAdmin.from("profiles").select("*").in("id", ids);
  const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  for (const post of posts) {
    if (!post.profiles && post.user_id) post.profiles = byId.get(post.user_id) ?? null;
  }
}

/**
 * Attach nested originals for repath posts. Always uses admin so RLS/embed
 * issues never blank the nested moment (mobile shows "unavailable" if missing).
 */
export async function attachOriginals(_userClient: any, posts: any[]): Promise<any[]> {
  const originalIds = Array.from(
    new Set((posts ?? []).map((p) => p?.repath_of).filter(Boolean))
  ) as string[];
  if (originalIds.length === 0) return posts;

  let { data: originals } = await loadPosts((select) =>
    supabaseAdmin.from("posts").select(select).in("id", originalIds)
  );

  const found = new Set((originals ?? []).map((o: any) => o.id));
  const missing = originalIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    const { data: extra } = await supabaseAdmin.from("posts").select("*").in("id", missing);
    if (extra && extra.length > 0) {
      await hydratePostProfiles(extra);
      originals = [...(originals ?? []), ...extra];
    }
  }

  const byId = new Map((originals ?? []).map((o: any) => [o.id, o]));
  for (const p of posts) {
    if (p?.repath_of) p.original = byId.get(p.repath_of) ?? null;
  }
  return posts;
}
