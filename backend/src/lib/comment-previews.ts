import { supabaseAdmin } from "../supabase";
import { resolveAvatarUrl } from "./avatar";
import { newestPerPost, pickCommentPreview } from "./comment-preview-select";

/** Max preview comments attached to each feed moment (exactly one under the card). */
export const COMMENT_PREVIEW_LIMIT = 1;

const BARE_SELECT = "id, post_id, user_id, content, created_at";

const PREVIEW_SELECT =
  "id, post_id, user_id, content, created_at, profiles:user_id(id, full_name, username, avatar_url, gender, is_verified)";

/** How many newest comments to scan per Moment when picking overall latest (blocked skip). */
const OVERALL_SCAN = 32;

/** Parallel per-Moment fetches for Moments where the viewer has not commented. */
const OVERALL_CONCURRENCY = 8;

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

/** Load profiles for a set of user ids in one query and attach onto comment rows. */
async function hydrateCommentProfiles(rows: any[]): Promise<void> {
  const need = rows.filter((r) => r && !r.profiles && !r.user);
  if (need.length === 0) return;

  const userIds = Array.from(
    new Set(
      need
        .map((r) => r?.user_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  if (userIds.length === 0) return;

  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, username, avatar_url, gender, is_verified")
    .in("id", userIds);

  if (error) {
    console.warn("[comment-previews] profile hydrate failed:", error.message);
    return;
  }

  const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  for (const row of need) {
    if (!row?.user_id) continue;
    row.profiles = byId.get(row.user_id) ?? null;
  }
}

/**
 * Latest eligible comment for one Moment (viewer priority already handled by caller).
 * Fetches a short newest window so blocked authors can be skipped without an empty preview.
 */
async function fetchOverallPreviewForPost(
  postId: string,
  viewerId: string,
  blocked: Set<string>,
): Promise<any | null> {
  const { data, error } = await supabaseAdmin
    .from("comments")
    .select(PREVIEW_SELECT)
    .eq("post_id", postId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(OVERALL_SCAN);

  if (error) {
    console.warn("[comment-previews] post query failed:", postId, error.message);
    // Bare fallback without embed if the profiles join fails.
    const bare = await supabaseAdmin
      .from("comments")
      .select(BARE_SELECT)
      .eq("post_id", postId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(OVERALL_SCAN);
    if (bare.error) {
      console.warn("[comment-previews] bare post query failed:", postId, bare.error.message);
      return null;
    }
    return pickCommentPreview(bare.data ?? [], viewerId, blocked);
  }

  return pickCommentPreview(data ?? [], viewerId, blocked);
}

/**
 * Attach exactly one selected preview comment to every post in `posts`
 * as `preview_comments` (formatted for the API).
 *
 * Selection (authenticated viewer from session — never from client body):
 * 1. Viewer's most recent comment on that Moment
 * 2. Else the latest overall comment (blocked authors skipped)
 * 3. Else none
 *
 * Strategy:
 * - One batch query for the viewer's comments across the whole page
 * - Concurrent per-Moment fetches only for Moments where the viewer has not commented
 *   (avoids a single cross-post LIMIT that starves quieter Moments)
 * - Does NOT depend on denormalized comment_count (historical counts can be stuck at 0)
 *
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
    if (ids.length === 0 || !viewerId) return;

    const blocked = new Set(blockedIds);
    const byPost = new Map<string, any>();

    // ── Query 1: viewer's comments on this page (priority source) ──────────
    const mineRes = await supabaseAdmin
      .from("comments")
      .select(PREVIEW_SELECT)
      .in("post_id", ids)
      .eq("user_id", viewerId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (mineRes.error) {
      console.warn("[comment-previews] viewer batch failed:", mineRes.error.message);
      const bareMine = await supabaseAdmin
        .from("comments")
        .select(BARE_SELECT)
        .in("post_id", ids)
        .eq("user_id", viewerId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (!bareMine.error) {
        for (const [postId, row] of newestPerPost(bareMine.data ?? [])) {
          byPost.set(postId, row);
        }
      }
    } else {
      for (const [postId, row] of newestPerPost(mineRes.data ?? [])) {
        byPost.set(postId, row);
      }
    }

    // ── Query 2: per-Moment latest overall for posts without a viewer comment ─
    // Never skip based on comment_count — historical denormalized counts may be 0
    // even when comments exist in the database.
    const needOverall = ids.filter((id) => !byPost.has(id));
    for (let i = 0; i < needOverall.length; i += OVERALL_CONCURRENCY) {
      const slice = needOverall.slice(i, i + OVERALL_CONCURRENCY);
      const results = await Promise.all(
        slice.map(async (postId) => {
          const picked = await fetchOverallPreviewForPost(postId, viewerId, blocked);
          return [postId, picked] as const;
        }),
      );
      for (const [postId, picked] of results) {
        if (picked) byPost.set(postId, picked);
      }
    }

    const pickedRows = Array.from(byPost.values());
    if (pickedRows.length === 0) return;

    await hydrateCommentProfiles(pickedRows);

    for (const p of targets) {
      const row = byPost.get(p.id);
      if (!row) continue;
      p.preview_comments = [formatCommentRow(row)];
      // Keep denormalized count at least consistent with a visible preview.
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
  return raw
    .map((c: any) => {
      if (!c) return null;
      if (c.user && c.userId != null && c.createdAt != null && c.content != null) return c;
      return formatCommentRow(c);
    })
    .filter(Boolean);
}
