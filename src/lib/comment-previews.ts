import { supabaseAdmin } from "../supabase";
import { resolveAvatarUrl } from "./avatar";
import { newestPerPost, pickCommentPreview } from "./comment-preview-select";
import { isSupabaseCircuitOpen } from "./supabase-circuit";

/** Max preview comments attached to each feed moment (exactly one under the card). */
export const COMMENT_PREVIEW_LIMIT = 1;

const BARE_SELECT =
  "id, post_id, user_id, content, created_at, location_label, location_city, location_region, location_country, location_precision, location_captured_at, location_shared";

const PREVIEW_SELECT =
  "id, post_id, user_id, content, created_at, location_label, location_city, location_region, location_country, location_precision, location_captured_at, location_shared, profiles:user_id(id, full_name, username, avatar_url, gender, is_verified)";

const PREVIEW_SELECT_LEGACY =
  "id, post_id, user_id, content, created_at, profiles:user_id(id, full_name, username, avatar_url, gender, is_verified)";

/** Newest comments to pull across the whole page in one query (then pick per post). */
const BATCH_SCAN_PER_POST = 8;

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
  const label =
    typeof comment.location_label === "string" && comment.location_label.trim()
      ? comment.location_label.trim()
      : typeof comment.location_city === "string" && comment.location_city.trim()
        ? [comment.location_city.trim(), comment.location_country?.trim()].filter(Boolean).join(", ")
        : undefined;
  const shared = comment.location_shared === true || !!label;
  const parentId = comment.parent_comment_id ?? comment.parentCommentId ?? null;
  return {
    id: comment.id,
    postId: comment.post_id ?? comment.postId,
    userId: comment.user_id ?? comment.userId,
    content: comment.content,
    createdAt: comment.created_at ?? comment.createdAt,
    updatedAt: comment.updated_at ?? comment.updatedAt ?? undefined,
    ...(parentId ? { parentCommentId: String(parentId) } : {}),
    // Public display only — never expose comment coordinates.
    ...(shared && label
      ? {
          locationLabel: label,
          locationCity: comment.location_city ?? undefined,
          locationRegion: comment.location_region ?? undefined,
          locationCountry: comment.location_country ?? undefined,
          locationPrecision: comment.location_precision ?? undefined,
          locationCapturedAt: comment.location_captured_at ?? undefined,
          locationShared: true,
        }
      : {}),
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
 * Attach exactly one selected preview comment to every post in `posts`
 * as `preview_comments` (formatted for the API).
 *
 * Selection (authenticated viewer from session — never from client body):
 * 1. Viewer's most recent comment on that Moment
 * 2. Else the latest overall comment (blocked authors skipped)
 * 3. Else none
 *
 * Strategy (Disk I/O safe):
 * - One batch query for the viewer's comments across the page
 * - One capped batch query for newest comments across the page (no per-Moment N+1)
 * - Skipped entirely while the Supabase Disk I/O circuit is open
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

    if (isSupabaseCircuitOpen()) return;

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
    let mineRes = await supabaseAdmin
      .from("comments")
      .select(PREVIEW_SELECT)
      .in("post_id", ids)
      .eq("user_id", viewerId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (mineRes.error && /location_|column/i.test(mineRes.error.message ?? "")) {
      mineRes = await supabaseAdmin
        .from("comments")
        .select(PREVIEW_SELECT_LEGACY)
        .in("post_id", ids)
        .eq("user_id", viewerId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
    }

    if (mineRes.error) {
      console.warn("[comment-previews] viewer batch failed:", mineRes.error.message);
      const bareMine = await supabaseAdmin
        .from("comments")
        .select("id, post_id, user_id, content, created_at")
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

    // ── Query 2: single batch of newest comments for remaining Moments ─────
    const needOverall = ids.filter((id) => !byPost.has(id));
    if (needOverall.length > 0) {
      const fetchLimit = Math.min(needOverall.length * BATCH_SCAN_PER_POST, 160);
      let rows: any[] = [];
      let withProfiles = await supabaseAdmin
        .from("comments")
        .select(PREVIEW_SELECT)
        .in("post_id", needOverall)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(fetchLimit);
      if (withProfiles.error && /location_|column/i.test(withProfiles.error.message ?? "")) {
        withProfiles = await supabaseAdmin
          .from("comments")
          .select(PREVIEW_SELECT_LEGACY)
          .in("post_id", needOverall)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(fetchLimit);
      }
      if (withProfiles.error) {
        console.warn("[comment-previews] overall batch failed:", withProfiles.error.message);
        const bare = await supabaseAdmin
          .from("comments")
          .select("id, post_id, user_id, content, created_at")
          .in("post_id", needOverall)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(fetchLimit);
        if (!bare.error) rows = bare.data ?? [];
      } else {
        rows = withProfiles.data ?? [];
      }

      const byPostRows = new Map<string, any[]>();
      for (const row of rows) {
        const pid = row?.post_id;
        if (!pid || typeof pid !== "string") continue;
        const list = byPostRows.get(pid) ?? [];
        if (list.length >= BATCH_SCAN_PER_POST) continue;
        list.push(row);
        byPostRows.set(pid, list);
      }
      for (const postId of needOverall) {
        const picked = pickCommentPreview(byPostRows.get(postId) ?? [], viewerId, blocked);
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
