import { supabaseAdmin } from "../supabase";
import { resolveAvatarUrl } from "./avatar";

/** Max preview comments attached to each feed moment (newest one under the card). */
export const COMMENT_PREVIEW_LIMIT = 1;

/** Author payload for comment list / create / edit / preview responses. */
export function formatCommentUser(userId: string, profile: any) {
  return {
    id: userId,
    name: String(profile?.full_name ?? profile?.name ?? "").trim(),
    username: String(profile?.username ?? "").trim(),
    avatar: resolveAvatarUrl(userId, profile?.avatar_url, profile?.gender),
    verified: profile?.is_verified === true,
  };
}

/** Same shape as items returned by GET /api/posts/:id/comments. */
export function formatCommentRow(comment: any) {
  return {
    id: comment.id,
    postId: comment.post_id,
    userId: comment.user_id,
    content: comment.content,
    createdAt: comment.created_at,
    user: formatCommentUser(comment.user_id, comment.profiles),
  };
}

/**
 * Attach the newest {@link COMMENT_PREVIEW_LIMIT} comment(s)
 * to every post in `posts` as `preview_comments`, already formatted for the API.
 * Uses ONE query for the whole page (no N+1). Also covers nested `original`
 * posts (repaths).
 *
 * Never throws — previews are best-effort and must not break the feed.
 */
export async function attachCommentPreviews(
  posts: any[],
  viewerId?: string,
  blockedIds: string[] = []
): Promise<void> {
  try {
    const targets: any[] = [];
    for (const p of posts ?? []) {
      if (!p) continue;
      targets.push(p);
      if (p.original) targets.push(p.original);
    }
    for (const p of targets) p.preview_comments = [];

    const ids = Array.from(
      new Set(targets.map((p) => p?.id).filter((id): id is string => typeof id === "string" && id.length > 0))
    );
    // Same rule as the comments list endpoint: comments need an authenticated viewer.
    if (ids.length === 0 || !viewerId) return;

    const blocked = new Set(blockedIds);
    // comment_count can drift, so it is not used to skip posts. Cap the single
    // query: enough headroom per post for blocked authors, bounded overall.
    const perPost = COMMENT_PREVIEW_LIMIT + (blocked.size > 0 ? 8 : 0) + 10;
    const rowCap = Math.min(ids.length * perPost, 1500);

    const { data, error } = await supabaseAdmin
      .from("comments")
      .select(
        "id, post_id, user_id, content, created_at, profiles:user_id(id, full_name, username, avatar_url, gender, is_verified)"
      )
      .in("post_id", ids)
      .order("created_at", { ascending: false })
      .limit(rowCap);

    if (error) {
      console.warn("[comment-previews] query failed:", error.message);
      return;
    }

    // Rows arrive newest-first; keep the newest N per post.
    const byPost = new Map<string, any[]>();
    for (const row of data ?? []) {
      if (!row?.post_id || !row.user_id) continue;
      if (row.user_id !== viewerId && blocked.has(row.user_id)) continue;
      const list = byPost.get(row.post_id) ?? [];
      if (list.length >= COMMENT_PREVIEW_LIMIT) continue;
      list.push(row);
      byPost.set(row.post_id, list);
    }

    for (const p of targets) {
      const rows = byPost.get(p.id);
      if (!rows?.length) continue;
      // Oldest → newest, like the comments sheet.
      p.preview_comments = rows.slice().reverse().map(formatCommentRow);
    }
  } catch (e) {
    console.warn("[comment-previews] failed:", e instanceof Error ? e.message : e);
  }
}

/** Passes pre-formatted preview comments through; formats raw DB rows. */
export function formatPreviewComments(p: any): any[] {
  const raw = Array.isArray(p?.preview_comments)
    ? p.preview_comments
    : Array.isArray(p?.previewComments)
      ? p.previewComments
      : [];
  return raw.map((c: any) =>
    c && c.post_id !== undefined && c.createdAt === undefined ? formatCommentRow(c) : c
  );
}
