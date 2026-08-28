import { supabaseAdmin } from "../supabase";
import { sendPushToUser } from "./push";

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

/**
 * Notify every real, distinct user @mentioned in `content` that
 * `authorName` mentioned them. Creates a "mention" notification (driving the
 * bell badge) + a push, with `post_id` so tapping opens the moment/comment.
 *
 * - Never notifies the author for mentioning themselves.
 * - Only notifies mentions that resolve to a real user.
 * - Does NOT filter by feed privacy: we still notify even for a moment the
 *   mentioned user can't access; tapping it goes through /post/:id, which is
 *   itself access-controlled, so a private moment stays inaccessible.
 *
 * Safe to call fire-and-forget — never throws.
 */
export async function notifyMentions(opts: {
  authorId: string;
  authorName: string;
  content: string | null | undefined;
  postId: string;
}): Promise<void> {
  const { authorId, authorName, content, postId } = opts;
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

    const rows = [...targetIds].map((uid) => ({
      user_id: uid,
      from_user_id: authorId,
      type: "mention",
      message: "mentioned you",
      post_id: postId,
      read: false,
    }));
    const { data: insertedRows } = await supabaseAdmin.from("notifications").insert(rows).select("id, user_id");

    const insertedByUser = new Map<string, string>();
    for (const row of insertedRows ?? []) {
      insertedByUser.set(row.user_id, row.id);
    }

    for (const uid of targetIds) {
      try {
        await sendPushToUser(supabaseAdmin, uid, "New Mention", `${authorName} mentioned you`, {
          postId,
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
