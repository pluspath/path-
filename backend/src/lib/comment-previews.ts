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

const PREVIEW_SELECT =
  "id, post_id, user_id, content, created_at, profiles:user_id(id, full_name, username, avatar_url, gender, is_verified)";

/**
 * Load the newest preview comment(s) for one post.
 * Per-post queries avoid a hot post starving the rest of the page.
 */
async function fetchNewestForPost(
  postId: string,
  viewerId: string,
  blocked: Set<string>,
  fetchLimit: number
): Promise<any[]> {
  const { data, error } = await supabaseAdmin
    .from("comments")
    .select(PREVIEW_SELECT)
    .eq("post_id", postId)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);

  if (error) {
    console.warn("[comment-previews] post query failed:", postId, error.message);
    return [];
  }

  const kept: any[] = [];
  for (const row of data ?? []) {
    if (!row?.post_id || !row.user_id) continue;
    if (row.user_id !== viewerId && blocked.has(row.user_id)) continue;
    kept.push(row);
    if (kept.length >= COMMENT_PREVIEW_LIMIT) break;
  }
  return kept;
}

/**
 * Attach the newest {@link COMMENT_PREVIEW_LIMIT} comment(s)
 * to every post in `posts` as `preview_comments`, already formatted for the API.
 * Loads newest-per-post in parallel so each moment gets its own latest comment.
 * Also covers nested `original` posts (repaths).
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
    // Extra rows so blocked authors can be skipped without leaving the preview empty.
    const fetchLimit = COMMENT_PREVIEW_LIMIT + (blocked.size > 0 ? 12 : 0);

    const byPost = new Map<string, any[]>();
    // Bound concurrency so a large page does not open dozens of sockets at once.
    const CONCURRENCY = 8;
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const slice = ids.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        slice.map(async (postId) => {
          const rows = await fetchNewestForPost(postId, viewerId, blocked, fetchLimit);
          return [postId, rows] as const;
        })
      );
      for (const [postId, rows] of results) {
        if (rows.length) byPost.set(postId, rows);
      }
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
