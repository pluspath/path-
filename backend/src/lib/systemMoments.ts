import { createHash } from "crypto";
import { supabaseAdmin } from "../supabase";
import { isCustomAvatar, isKnownDefaultAvatarUrl, resolveAvatarUrl } from "./avatar";

// Covers the app shows when a profile has no uploaded cover. Clients often send
// these back on an unrelated save (for example a profile-picture change).
const PLACEHOLDER_COVER_MARKERS = [
  "photo-1519638399535-1b036603ac77",
  "photo-1506905925346-21bda4d32df4",
];

export function isPlaceholderCoverUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return true;
  const trimmed = url.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_COVER_MARKERS.some((marker) => trimmed.includes(marker));
}

/** Strip display-only transforms so a rendered URL compares equal to the stored one. */
export function canonicalMediaUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    parsed.pathname = parsed.pathname.replace(
      "/storage/v1/render/image/public/",
      "/storage/v1/object/public/"
    );
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return trimmed;
  }
}

/** Null means "no photo the user chose" (empty, default avatar, or placeholder cover). */
export function canonicalProfileImage(
  url: string | null | undefined,
  kind: "avatar" | "cover"
): string | null {
  if (kind === "cover") {
    if (isPlaceholderCoverUrl(url)) return null;
    return canonicalMediaUrl(url);
  }
  if (!url || isKnownDefaultAvatarUrl(url)) return null;
  return canonicalMediaUrl(url);
}

export function profileImageActuallyChanged(
  oldUrl: string | null | undefined,
  nextUrl: string | null | undefined,
  kind: "avatar" | "cover"
): boolean {
  return canonicalProfileImage(oldUrl, kind) !== canonicalProfileImage(nextUrl, kind);
}

/**
 * URL to persist for an avatar/cover field, or null when the request did not
 * really change that image. Ignores echoed defaults so a profile-picture save
 * cannot also create a cover-photo moment (and the reverse).
 */
export function acceptedProfileImageUpdate(
  oldUrl: string | null | undefined,
  incoming: unknown,
  kind: "avatar" | "cover"
): string | null {
  if (typeof incoming !== "string") return null;
  const next = incoming.trim();
  if (!next) return null;
  if (kind === "avatar") {
    if (!isCustomAvatar(next)) return null;
  } else if (isPlaceholderCoverUrl(next)) {
    return null;
  }
  if (!profileImageActuallyChanged(oldUrl, next, kind)) return null;
  return canonicalMediaUrl(next) ?? next;
}

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
      .select("id, avatar_url, gender")
      .in("id", Array.from(friendIds));

    const avatarById: Record<string, string> = {};
    for (const pr of profiles ?? []) {
      avatarById[pr.id] = resolveAvatarUrl(pr.id, pr.avatar_url, pr.gender);
    }

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

// One in-flight insert per user + moment type + image, so a double save cannot
// publish the same cover (or profile picture) moment twice.
const imageMomentInflight = new Map<string, Promise<void>>();

function imageMomentKey(userId: string, type: string, imageUrl: string): string {
  const canon = canonicalMediaUrl(imageUrl) ?? imageUrl.trim();
  return `${userId}:${type}:${canon}`;
}

/** Stable id for the same change inside a short window. A repeat insert conflicts and is ignored. */
function imageMomentId(userId: string, type: string, imageUrl: string): string {
  const canon = canonicalMediaUrl(imageUrl) ?? imageUrl.trim();
  const bucket = Math.floor(Date.now() / (2 * 60 * 1000));
  const hex = createHash("sha256").update(`${userId}:${type}:${canon}:${bucket}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function recentImageMomentExists(
  userId: string,
  type: string,
  imageUrl: string
): Promise<boolean> {
  const canon = canonicalMediaUrl(imageUrl) ?? imageUrl.trim();
  const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("posts")
    .select("image_url")
    .eq("user_id", userId)
    .eq("type", type)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);
  return (data ?? []).some((row) => (canonicalMediaUrl(row.image_url) ?? row.image_url) === canon);
}

async function writeImageMoment(userId: string, type: string, imageUrl: string): Promise<void> {
  if (await recentImageMomentExists(userId, type, imageUrl)) return;
  const { error } = await supabaseAdmin.from("posts").insert({
    id: imageMomentId(userId, type, imageUrl),
    user_id: userId,
    type,
    image_url: imageUrl,
  });
  // 23505 = unique violation: the same change was inserted a moment ago.
  if (error && error.code !== "23505") {
    console.error(`[systemMoments] ${type} insert failed:`, error.message);
  }
}

async function insertImageMoment(userId: string, type: string, imageUrl: string): Promise<void> {
  try {
    if (!userId || !imageUrl) return;
    const key = imageMomentKey(userId, type, imageUrl);
    const pending = imageMomentInflight.get(key);
    if (pending) {
      await pending;
      return;
    }
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    imageMomentInflight.set(key, gate);
    try {
      await writeImageMoment(userId, type, imageUrl);
    } finally {
      imageMomentInflight.delete(key);
      release();
    }
  } catch (e) {
    console.error(`[systemMoments] insert ${type} error:`, e);
  }
}
