import { supabaseAdmin } from "../supabase";

// System moments are special posts created automatically by the app. Like the
// "Joined Path+" moment, they cannot be edited or deleted, are scoped to
// friends, and can receive reactions/comments. They reuse the existing `posts`
// columns (no schema change):
//   friendship     → content = JSON array of {id, name, avatar} for everyone
//                    the owner became friends with that day (grouped per day);
//                    image_url = most-recent friend's avatar (type-icon),
//                    location = most-recent friend's user id (avatar tap target)
//   avatar_change  → image_url = the new avatar
//   cover_change   → image_url = the new cover photo
export const FRIENDSHIP_TYPE = "friendship";
export const AVATAR_CHANGE_TYPE = "avatar_change";
export const COVER_CHANGE_TYPE = "cover_change";

// Every auto-generated system moment type. These can never be edited/deleted.
export const SYSTEM_MOMENT_TYPES = [
  "joined",
  FRIENDSHIP_TYPE,
  AVATAR_CHANGE_TYPE,
  COVER_CHANGE_TYPE,
  "birthday",
];

// One entry in a friendship moment's grouped friend list.
export type FriendEntry = { id: string; name: string; avatar: string | null };

// Parse a friendship moment's `content` into its grouped friend list. Handles
// both the new JSON-array format and legacy single-friend rows (where `content`
// was the friend's plain name and `location`/`image_url` held the id/avatar).
export function parseFriendshipFriends(row: any): FriendEntry[] {
  const ownerId = row?.user_id ?? null;
  const seen = new Set<string>();
  const push = (list: FriendEntry[], f: FriendEntry) => {
    if (!f.id || seen.has(f.id)) return;
    if (ownerId && f.id === ownerId) return;
    const name = (f.name ?? "").trim();
    if (!name) return;
    seen.add(f.id);
    list.push({ id: String(f.id), name, avatar: f.avatar ?? null });
  };

  const out: FriendEntry[] = [];

  if (row?.content) {
    try {
      const parsed = JSON.parse(row.content);
      if (Array.isArray(parsed)) {
        for (const f of parsed) {
          if (f && f.id) {
            push(out, {
              id: String(f.id),
              name: f.name ?? "",
              avatar: f.avatar ?? null,
            });
          }
        }
        return out;
      }
    } catch {
      // not JSON → legacy single-friend row, fall through
    }
  }
  // Legacy row: content = name, location = friend id, image_url = avatar.
  if (row?.location || row?.content) {
    push(out, {
      id: row.location ?? "",
      name: row.content ?? "",
      avatar: row.image_url ?? null,
    });
  }
  return out;
}

// True if `isoDate` falls on the same calendar day as `now`. We don't store the
// user's timezone, so this uses the server-local day as a proxy for "the user's
// local day" — good enough to group friendships accepted in a single sitting.
function isSameDay(isoDate: string, now: Date): boolean {
  const d = new Date(isoDate);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

// Create the reciprocal "Became friends with X" moments for a freshly-accepted
// friendship: each user gets one on their own timeline, referencing the OTHER
// user. Same-day friendships are GROUPED into a single moment per user (see
// ensureOneFriendshipMoment). Idempotent per (owner, friend) pair.
export async function ensureFriendshipMoments(userAId: string, userBId: string): Promise<void> {
  try {
    if (!userAId || !userBId || userAId === userBId) return;

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", [userAId, userBId]);

    const byId: Record<string, any> = {};
    for (const p of profiles ?? []) byId[p.id] = p;
    const a = byId[userAId];
    const b = byId[userBId];
    if (!a || !b) return;

    await ensureOneFriendshipMoment(a, b);
    await ensureOneFriendshipMoment(b, a);
  } catch (e) {
    console.error("[systemMoments] ensureFriendshipMoments error:", e);
  }
}

async function ensureOneFriendshipMoment(owner: any, friend: any): Promise<void> {
  const now = new Date();
  const entry: FriendEntry = {
    id: friend.id,
    name: friend.full_name ?? "",
    avatar: friend.avatar_url ?? null,
  };

  // Look at the owner's most recent friendship moment. If it was created today,
  // we append this friend to it; otherwise we start a fresh moment for today.
  const { data: latest } = await supabaseAdmin
    .from("posts")
    .select("id, content, created_at")
    .eq("user_id", owner.id)
    .eq("type", FRIENDSHIP_TYPE)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest && isSameDay(latest.created_at, now)) {
    const friends = parseFriendshipFriends(latest);
    // Idempotency: never add the same pair twice within one moment.
    if (friends.some((f) => f.id === entry.id)) return;

    friends.push(entry);
    const { error } = await supabaseAdmin
      .from("posts")
      .update({
        content: JSON.stringify(friends),
        image_url: entry.avatar, // newest friend's avatar → type-icon
        location: entry.id, // newest friend's id → avatar tap target
        created_at: now.toISOString(), // bump to the top of the timeline
      })
      .eq("id", latest.id);
    if (error) console.error("[systemMoments] friendship group update failed:", error.message);
    return;
  }

  // No friendship moment today → create a fresh one for this friend.
  const { error } = await supabaseAdmin.from("posts").insert({
    user_id: owner.id,
    type: FRIENDSHIP_TYPE,
    content: JSON.stringify([entry]),
    image_url: entry.avatar,
    location: entry.id,
  });
  if (error) console.error("[systemMoments] friendship insert failed:", error.message);
}

// Auto-generated friendship moments store a SNAPSHOT of each friend's avatar at
// creation time (in `content` and `image_url`). That goes stale when the friend
// later changes their profile picture. This refreshes every friendship moment in
// a formatted-post list with the friends' CURRENT avatars, fetched live from the
// profiles table — so the timeline always shows up-to-date avatars. Mutates the
// passed posts in place. Safe to call on any post list (non-friendship posts are
// ignored). Best-effort: on any error the original (snapshot) avatars survive.
export async function refreshFriendshipAvatars(posts: any[]): Promise<void> {
  try {
    const friendIds = new Set<string>();
    for (const p of posts ?? []) {
      if (p?.type !== FRIENDSHIP_TYPE) continue;
      for (const f of p.friends ?? []) if (f?.id) friendIds.add(String(f.id));
    }
    if (friendIds.size === 0) return;

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, avatar_url")
      .in("id", Array.from(friendIds));

    const avatarById: Record<string, string | null> = {};
    for (const pr of profiles ?? []) avatarById[pr.id] = pr.avatar_url ?? null;

    for (const p of posts ?? []) {
      if (p?.type !== FRIENDSHIP_TYPE || !Array.isArray(p.friends)) continue;
      // Refresh each grouped friend's avatar.
      for (const f of p.friends) {
        if (f?.id && f.id in avatarById) f.avatar = avatarById[f.id];
      }
      // `image` is the type-icon avatar shown in the timeline. It maps to the
      // moment's `locationName` (most-recent friend), falling back to the first.
      const primary =
        p.friends.find((f: any) => f.id === p.locationName) ?? p.friends[0];
      if (primary && primary.id in avatarById) {
        p.image = avatarById[primary.id] ?? undefined;
      }
    }
  } catch (e) {
    console.error("[systemMoments] refreshFriendshipAvatars error:", e);
  }
}

// Create a "Changed profile picture" moment showing the new avatar. Call this
// ONLY when the avatar actually changed (the caller compares old vs new).
export async function ensureAvatarChangeMoment(userId: string, newAvatarUrl: string): Promise<void> {
  await insertImageMoment(userId, AVATAR_CHANGE_TYPE, newAvatarUrl);
}

// Create a "Changed cover photo" moment showing the new cover. Call this ONLY
// when the cover actually changed.
export async function ensureCoverChangeMoment(userId: string, newCoverUrl: string): Promise<void> {
  await insertImageMoment(userId, COVER_CHANGE_TYPE, newCoverUrl);
}

async function insertImageMoment(userId: string, type: string, imageUrl: string): Promise<void> {
  try {
    if (!userId || !imageUrl) return;
    const { error } = await supabaseAdmin
      .from("posts")
      .insert({ user_id: userId, type, image_url: imageUrl });
    if (error) console.error(`[systemMoments] ${type} insert failed:`, error.message);
  } catch (e) {
    console.error(`[systemMoments] insert ${type} error:`, e);
  }
}
