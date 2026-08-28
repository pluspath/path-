import { supabaseAdmin } from "../supabase";
import { sendPushToUser } from "./push";

// The "Birthday" auto-moment: on a user's birthday a system moment is created on
// THEIR own timeline ("🎂 It's my birthday today!") and every accepted friend
// gets a notification so they can react/comment to wish them. It's a system
// moment (friends-only audience, not editable/deletable) and is independent of
// the show_age / show_zodiac visibility toggles.
//
// Detection: this stack has no cron, so we check lazily on a lightweight server
// call (the home-timeline fetch). To make sure friends are still notified even
// when the birthday person hasn't opened the app, every viewer also checks
// their accepted friends' birthdays. Creation is idempotent — exactly ONE
// birthday moment per user per year (the year is stored in `content`), so it's
// safe to run on every poll and from any viewer.
//
// Timezone: we don't store a per-user timezone, so the match uses the
// server-local calendar day as a proxy for "the user's local day", consistent
// with the friendship grouping logic.
export const BIRTHDAY_TYPE = "birthday";

// "MM-DD" for the given date in server-local time. profiles.birthday is stored
// as "YYYY-MM-DD", so a row matches today when it ends with "-MM-DD".
function monthDay(now: Date): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

// Idempotently create today's birthday moment for `person` and notify all their
// accepted friends. No-op if this year's moment already exists.
async function ensureBirthdayForUser(person: any, now: Date): Promise<void> {
  const yearStr = String(now.getFullYear());

  // One moment per user per year — the year lives in `content` as the dedupe key.
  const { data: existing } = await supabaseAdmin
    .from("posts")
    .select("id")
    .eq("user_id", person.id)
    .eq("type", BIRTHDAY_TYPE)
    .eq("content", yearStr)
    .limit(1)
    .maybeSingle();
  if (existing) return;

  const { data: post, error } = await supabaseAdmin
    .from("posts")
    .insert({ user_id: person.id, type: BIRTHDAY_TYPE, content: yearStr })
    .select("id")
    .single();
  if (error || !post) {
    // A unique-ish race (two viewers at once) can collide here; just bail —
    // the moment already exists, so we must not double-notify.
    if (error) console.error("[birthday] insert moment failed:", error.message);
    return;
  }

  // Notify every accepted friend (never the birthday person themselves).
  const { data: friendships } = await supabaseAdmin
    .from("friendships")
    .select("requester_id, receiver_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${person.id},receiver_id.eq.${person.id}`);

  const friendIds = (friendships ?? []).map((f: any) =>
    f.requester_id === person.id ? f.receiver_id : f.requester_id
  );
  if (friendIds.length === 0) return;

  const name = person.full_name || "Someone";
  const message = `${name}'s birthday is today — wish them a happy birthday!`;

  const rows = friendIds.map((fid: string) => ({
    user_id: fid,
    from_user_id: person.id,
    type: BIRTHDAY_TYPE,
    message,
    post_id: post.id,
    read: false,
  }));
  const { data: insertedRows, error: notifErr } = await supabaseAdmin
    .from("notifications")
    .insert(rows)
    .select("id, user_id");
  if (notifErr) console.error("[birthday] notifications insert failed:", notifErr.message);

  const insertedByUser = new Map<string, string>();
  for (const row of insertedRows ?? []) {
    insertedByUser.set(row.user_id, row.id);
  }

  for (const fid of friendIds) {
    try {
      await sendPushToUser(supabaseAdmin, fid, "🎂 Birthday", message, {
        postId: post.id,
        type: BIRTHDAY_TYPE,
        fromUserId: person.id,
        notificationId: insertedByUser.get(fid),
      });
    } catch (e) {
      console.error("[birthday] push error for", fid, e);
    }
  }
}

// Check the viewer and their accepted friends for a birthday today, creating the
// moment + notifications as needed. Cheap on a normal day (usually 0 matches).
export async function ensureBirthdayMoments(userId: string, friendIds: string[]): Promise<void> {
  try {
    if (!userId) return;
    const now = new Date();
    const md = monthDay(now);
    const candidateIds = Array.from(new Set([userId, ...friendIds]));

    const { data: birthdayPeople } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, birthday")
      .in("id", candidateIds)
      .like("birthday", `%-${md}`);

    for (const person of birthdayPeople ?? []) {
      if (!person.birthday) continue;
      await ensureBirthdayForUser(person, now);
    }
  } catch (e) {
    console.error("[birthday] ensureBirthdayMoments error:", e);
  }
}
