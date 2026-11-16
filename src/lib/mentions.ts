import { supabaseAdmin } from "../supabase";
import { sendPushToUser } from "./push";
import { isBlocked } from "./blocks";

// Matches @mention tokens: latin + accented + Arabic letters, digits, underscore.
// Mirrors the client-side TOKEN_RE in mobile/src/components/RichText.tsx so the
// backend extracts exactly the tokens the app renders as blue mentions.
const MENTION_RE = /@([A-Za-z0-9_À-ɏ؀-ۿ]+)/g;

function extractMentions(content: string | null | undefined): string[] {
  if (!content) return [];
  const out: string[] = [];
  let m: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(content)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

// Resolve a single @handle to a real user. Mentions are inserted by the
// composer as the user's username (preferred) or their name with spaces
// stripped — so we match username (case-insensitive) first, then fall back to a
// space-stripped full_name match. Returns null when nothing matches (so a
// mention of a non-user never produces a notification). Mirrors the
// GET /api/by-username/:username resolution.
async function resolveHandle(handle: string): Promise<{ id: string } | null> {
  const raw = handle.replace(/^@+/, "").trim();
  if (!raw) return null;

  const { data: byUsername } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, username")
    .ilike("username", raw)
    .limit(1)
    .maybeSingle();
  if (byUsername) return byUsername;

  const { data: candidates } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, username")
    .ilike("full_name", `%${raw}%`)
    .limit(20);
  const target = raw.toLowerCase();
  return (
    (candidates ?? []).find(
      (p: any) => (p.full_name ?? "").replace(/\s+/g, "").toLowerCase() === target
    ) ?? null
  );
}

/** true / false when known; null when the friendship lookup failed (allow notify). */
async function areAcceptedFriends(a: string, b: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("friendships")
      .select("id")
      .eq("status", "accepted")
      .or(
        `and(requester_id.eq.${a},receiver_id.eq.${b}),and(requester_id.eq.${b},receiver_id.eq.${a})`
      )
      .maybeSingle();
    if (error) return null;
    return !!data;
  } catch {
    return null;
  }
}

async function persistMentionRow(opts: {
  postId: string;
  mentionedUserId: string;
  mentionedBy: string;
  commentId?: string;
}): Promise<void> {
  try {
    const base = {
      post_id: opts.postId,
      mentioned_user_id: opts.mentionedUserId,
      mentioned_by: opts.mentionedBy,
    };
    // Prefer comment-aware row when the column exists; ignore missing-table/column.
    if (opts.commentId) {
      const withComment = await supabaseAdmin.from("mentions").upsert(
        { ...base, comment_id: opts.commentId },
        { onConflict: "post_id,mentioned_user_id" }
      );
      if (!withComment.error) return;
      if (!/comment_id|column|does not exist|relation|schema cache/i.test(withComment.error.message ?? "")) {
        return;
      }
    }
    await supabaseAdmin
      .from("mentions")
      .upsert(base, { onConflict: "post_id,mentioned_user_id" });
  } catch {
    // Mentions table is optional — never fail notifications on it.
  }
}

/**
 * Notify every real, distinct user @mentioned in `content` that
 * `authorName` mentioned them. Creates a "mention" notification (driving the
 * bell badge) + a push, with `post_id` (and optional `comment_id`) so tapping
 * opens the moment/comment.
 *
 * - Never notifies the author for mentioning themselves.
 * - Only notifies mentions that resolve to a real user.
 * - Skips blocked relationships; prefers accepted friends (falls open if check fails).
 * - Safe to call fire-and-forget — never throws.
 */
export async function notifyMentions(opts: {
  authorId: string;
  authorName: string;
  content: string | null | undefined;
  postId: string;
  commentId?: string;
}): Promise<void> {
  const { authorId, authorName, content, postId, commentId } = opts;
  try {
    const handles = extractMentions(content);
    if (handles.length === 0) return;

    const seenHandles = new Set<string>();
    const targetIds = new Set<string>();
    for (const h of handles) {
      const key = h.toLowerCase();
      if (seenHandles.has(key)) continue;
      seenHandles.add(key);
      const prof = await resolveHandle(h);
      if (prof && prof.id !== authorId) targetIds.add(prof.id);
    }
    if (targetIds.size === 0) return;

    const allowedIds: string[] = [];
    for (const uid of targetIds) {
      try {
        const blocked =
          (await isBlocked(authorId, uid)) || (await isBlocked(uid, authorId));
        if (blocked) continue;
        const friends = await areAcceptedFriends(authorId, uid);
        // Prefer friends-only; if friendship status is unknown, still notify
        // (backward compatible / never throw).
        if (friends === false) continue;
        allowedIds.push(uid);
      } catch {
        allowedIds.push(uid);
      }
    }
    if (allowedIds.length === 0) return;

    for (const uid of allowedIds) {
      void persistMentionRow({
        postId,
        mentionedUserId: uid,
        mentionedBy: authorId,
        commentId,
      });
    }

    const baseRows = allowedIds.map((uid) => ({
      user_id: uid,
      from_user_id: authorId,
      type: "mention",
      message: "mentioned you",
      post_id: postId,
      read: false,
    }));

    let insertedRows: Array<{ id: string; user_id: string }> | null = null;
    if (commentId) {
      const withComment = await supabaseAdmin
        .from("notifications")
        .insert(baseRows.map((r) => ({ ...r, comment_id: commentId })))
        .select("id, user_id");
      if (withComment.error && /comment_id|column/i.test(withComment.error.message ?? "")) {
        const fallback = await supabaseAdmin
          .from("notifications")
          .insert(baseRows)
          .select("id, user_id");
        insertedRows = fallback.data;
      } else {
        insertedRows = withComment.data;
      }
    } else {
      const { data } = await supabaseAdmin
        .from("notifications")
        .insert(baseRows)
        .select("id, user_id");
      insertedRows = data;
    }

    const insertedByUser = new Map<string, string>();
    for (const row of insertedRows ?? []) {
      insertedByUser.set(row.user_id, row.id);
    }

    for (const uid of allowedIds) {
      try {
        await sendPushToUser(supabaseAdmin, uid, "New Mention", `${authorName} mentioned you`, {
          postId,
          ...(commentId ? { commentId } : {}),
          type: "mention",
          fromUserId: authorId,
          notificationId: insertedByUser.get(uid),
        });
      } catch (e) {
        console.error("[notifications] mention push error:", e);
      }
    }
  } catch (e) {
    console.error("[notifications] mention insert error:", e);
  }
}
