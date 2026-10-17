import { supabaseAdmin } from "../supabase";

// Do NOT nest profiles inside reactions — that embed is fragile (ambiguous FKs /
// schema-cache lag) and often returns null names ("a friend" in the app).
// Reactor identities are always filled by hydrateReactionProfiles() instead.
export const POST_SELECT =
  "*, profiles!user_id(*), reactions(user_id, type)";
export const POST_SELECT_BASIC = "*, profiles!user_id(*)";
export const POST_SELECT_MIN = "*";

/**
 * Load posts with the service-role client (bypasses RLS). Privacy is enforced
 * in route handlers. Nested embeds can fail after schema-cache lag; we fall back.
 * Reaction actor profiles are always hydrated separately so names never go blank.
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
      // BASIC/MIN may omit reactions entirely — still fine; routes that need
      // reactions use POST_SELECT. Always try to attach actor profiles when present.
      await hydrateReactionProfiles(rows);
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

/** Attach live profile rows onto each reaction so formatReactions always has names. */
export async function hydrateReactionProfiles(posts: any[]): Promise<void> {
  const ids = new Set<string>();
  const collect = (list: any[] | undefined) => {
    for (const r of list ?? []) {
      const id = r?.user_id ?? r?.userId;
      if (id) ids.add(String(id));
    }
  };
  for (const p of posts ?? []) {
    collect(p?.reactions);
    collect(p?.original?.reactions);
  }
  if (ids.size === 0) return;

  const byId: Record<string, any> = {};
  const all = Array.from(ids);
  for (let i = 0; i < all.length; i += 80) {
    const chunk = all.slice(i, i + 80);
    // Only columns that exist on every Path+ profiles schema (no bare `name`).
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, username, avatar_url, gender")
      .in("id", chunk);
    if (error) {
      console.warn("[posts] hydrateReactionProfiles failed:", error.message);
      continue;
    }
    for (const pr of data ?? []) byId[pr.id] = pr;
  }

  const attach = (list: any[] | undefined) => {
    if (!Array.isArray(list)) return;
    for (const r of list) {
      const id = r?.user_id ?? r?.userId;
      if (!id) continue;
      const profile = byId[String(id)];
      if (profile) r.profiles = profile;
    }
  };

  for (const p of posts ?? []) {
    attach(p?.reactions);
    if (p?.original) attach(p.original.reactions);
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
      // Load reactions for originals fetched via bare select.
      await attachReactionsForPosts(extra);
      await hydrateReactionProfiles(extra);
      originals = [...(originals ?? []), ...extra];
    }
  }

  const byId = new Map((originals ?? []).map((o: any) => [o.id, o]));
  for (const p of posts) {
    if (p?.repath_of) p.original = byId.get(p.repath_of) ?? null;
  }
  return posts;
}

/** When a post row has no reactions array, fetch them explicitly. */
async function attachReactionsForPosts(posts: any[]): Promise<void> {
  const need = (posts ?? []).filter((p) => p?.id && !Array.isArray(p.reactions));
  if (need.length === 0) return;
  const ids = need.map((p) => p.id);
  const { data: reactions, error } = await supabaseAdmin
    .from("reactions")
    .select("post_id, user_id, type")
    .in("post_id", ids);
  if (error) {
    console.warn("[posts] attachReactionsForPosts failed:", error.message);
    return;
  }
  const byPost = new Map<string, any[]>();
  for (const r of reactions ?? []) {
    const list = byPost.get(r.post_id) ?? [];
    list.push(r);
    byPost.set(r.post_id, list);
  }
  for (const p of need) {
    p.reactions = byPost.get(p.id) ?? [];
  }
}
