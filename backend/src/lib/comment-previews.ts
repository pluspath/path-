import { supabaseAdmin } from "../supabase";
import { resolveAvatarUrl } from "./avatar";
import { newestPerPost, pickCommentPreview } from "./comment-preview-select";

/** Max preview comments attached to each feed moment (exactly one under the card). */
export const COMMENT_PREVIEW_LIMIT = 1;

/** Author payload for comment list / create / edit / preview responses. */
export function formatCommentUser(userId: string, profile: any) {
  const p = Array.isArray(profile) ? profile[0] : profile;
  return {
    id: userId,
    name: String(p?.full_name ?? p?.name ?? "").trim(),
    username: String(p?.username ?? "").trim(),
    avatar: resolveAvatarUrl(userId, p?.avatar_url, p?.gender),
    verified: p?.is_verified === true,
  };
}

/** Same shape as items returned by GET /api/posts/:id/comments. */
export function formatCommentRow(comment: any) {
  return {
    id: comment.id,
    postId: comment.post_id ?? comment.postId,
    userId: comment.user_id ?? comment.userId,
    content: comment.content,
    createdAt: comment.created_at ?? comment.createdAt,
    user: formatCommentUser(
      comment.user_id ?? comment.userId,
      comment.profiles ?? comment.user,
    ),
  };
}

const PREVIEW_SELECT =
  "id, post_id, user_id, content, created_at, profiles:user_id(id, full_name, username, avatar_url, gender, is_verified)";

/**
 * Load candidate comments for one post and pick the preview using viewer priority.
 * Extra rows let blocked authors be skipped without leaving the preview empty.
 */
async function fetchCommentRowsForPost(postId: string, fetchLimit: number): Promise<any[]> {
  const withProfiles = await supabaseAdmin
    .from("comments")
    .select(PREVIEW_SELECT)
    .eq("post_id", postId)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);

  if (!withProfiles.error) return withProfiles.data ?? [];

  // Fallback without embed if the profiles FK/select fails — still return the comment text.
  console.warn(
    "[comment-previews] post query with profiles failed:",
    postId,
    withProfiles.error.message,
  );
  const bare = await supabaseAdmin
    .from("comments")
    .select("id, post_id, user_id, content, created_at")
    .eq("post_id", postId)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);

  if (bare.error) {
    console.warn("[comment-previews] bare post query failed:", postId, bare.error.message);
    return [];
  }
  return bare.data ?? [];
}

async function fetchPreviewForPost(
  postId: string,
  viewerId: string,
  blocked: Set<string>,
  fetchLimit: number,
): Promise<any | null> {
  const data = await fetchCommentRowsForPost(postId, fetchLimit);
  return pickCommentPreview(data, viewerId, blocked);
}

/**
 * Attach exactly one selected preview comment to every post in `posts`
 * as `preview_comments` (formatted for the API).
 *
 * Selection (authenticated viewer from session):
 * 1. Viewer's most recent comment on that Moment
 * 2. Else the latest overall comment (blocked authors skipped)
 * 3. Else none
 *
 * Strategy: one batch query for the viewer's comments across the page, then
 * per-post fetches only for Moments where the viewer has not commented.
 * Never throws — previews are best-effort and must not break the feed.
 */
export async function attachCommentPreviews(
  posts: any[],
  viewerId?: string,
  blockedIds: string[] = [],
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
      new Set(
        targets
          .map((p) => p?.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    );
    // Same rule as the comments list endpoint: comments need an authenticated viewer.
    if (ids.length === 0 || !viewerId) return;

    const blocked = new Set(blockedIds);
    const byPost = new Map<string, any>();

    // 1) Batch: viewer's newest comment per Moment on this page.
    const { data: mineRows, error: mineError } = await supabaseAdmin
      .from("comments")
      .select(PREVIEW_SELECT)
      .in("post_id", ids)
      .eq("user_id", viewerId)
      .order("created_at", { ascending: false });

    if (mineError) {
      console.warn("[comment-previews] viewer batch failed:", mineError.message);
    } else {
      for (const [postId, row] of newestPerPost(mineRows ?? [])) {
        byPost.set(postId, row);
      }
    }

    // 2) Moments without a viewer comment → latest overall (blocked skipped).
    const needOverall = ids.filter((id) => !byPost.has(id));
    const fetchLimit = COMMENT_PREVIEW_LIMIT + 24 + (blocked.size > 0 ? 12 : 0);
    const CONCURRENCY = 8;
    for (let i = 0; i < needOverall.length; i += CONCURRENCY) {
      const slice = needOverall.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        slice.map(async (postId) => {
          const picked = await fetchPreviewForPost(postId, viewerId, blocked, fetchLimit);
          return [postId, picked] as const;
        }),
      );
      for (const [postId, picked] of results) {
        if (picked) byPost.set(postId, picked);
      }
    }

    for (const p of targets) {
      const row = byPost.get(p.id);
      if (!row) continue;
      p.preview_comments = [formatCommentRow(row)];
      // Keep feed "Read all N" honest when the stored counter lagged behind.
      p.comment_count = Math.max(Number(p.comment_count ?? 0) || 0, 1);
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
    c && c.post_id !== undefined && c.createdAt === undefined ? formatCommentRow(c) : c,
  );
}
