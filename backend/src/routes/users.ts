import { Hono } from "hono";
import { supabase, supabaseAdmin, createUserClient } from "../supabase";
import { ensureAvatarChangeMoment, ensureCoverChangeMoment, FRIENDSHIP_TYPE, parseFriendshipFriends, refreshFriendshipAvatars } from "../lib/systemMoments";
import { computeAge, computeZodiac } from "../lib/profileMeta";
import { decodeImages } from "../lib/images";
import { getBlockedIds } from "../lib/blocks";
import { formatDuration } from "../lib/duration";
import type { HonoVariables, Profile } from "../types";

const usersRouter = new Hono<{ Variables: HonoVariables }>();

// `viewerId` is the id of the user requesting this profile. The owner always
// sees their own age/zodiac (plus the raw birthday, needed to drive the
// toggles). Everyone else sees age/zodiac ONLY when the owner has opted in via
// show_age / show_zodiac, and never sees the raw birthday.
function formatProfile(p: any, postCount = 0, friendCount = 0, viewerId?: string) {
  const isOwner = !!viewerId && viewerId === p.id;
  const showAge = p.show_age ?? false;
  const showZodiac = p.show_zodiac ?? false;
  const age = computeAge(p.birthday);
  const zodiac = computeZodiac(p.birthday);

  // Profile section privacy (friends list / posts / moments).
  const privacy = {
    showFriendsToFriends: p.show_friends_to_friends ?? true,
    showFriendsToOthers: p.show_friends_to_others ?? false,
    showPostsToFriends: p.show_posts_to_friends ?? true,
    showPostsToOthers: p.show_posts_to_others ?? true,
    showMomentsToFriends: p.show_moments_to_friends ?? true,
    showMomentsToOthers: p.show_moments_to_others ?? true,
  };

  return {
    id: p.id,
    name: p.full_name ?? "",
    username: p.username ?? "",
    email: "",
    avatar: p.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.id}`,
    bio: p.bio ?? "",
    location: p.location ?? "",
    // Raw birthday is private — only ever returned to the profile owner.
    birthday: isOwner ? (p.birthday ?? "") : "",
    gender: p.gender ?? "",
    coverPhoto: p.cover_url ?? "https://images.unsplash.com/photo-1519638399535-1b036603ac77?w=800",
    joinDate: p.created_at ?? new Date().toISOString(),
    friendCount,
    postCount,
    momentCount: postCount,
    // Computed age/zodiac, gated by visibility for non-owners.
    age: isOwner || showAge ? age : null,
    zodiac: isOwner || showZodiac ? zodiac : null,
    showAge,
    showZodiac,
    usernameChanged: p.username_changed ?? false,
    pushNotificationsEnabled: p.push_notifications_enabled ?? true,
    emailNotificationsEnabled: p.email_notifications_enabled ?? false,
    preferredLanguage: p.preferred_language === "ar" ? "ar" : "en",
    ...privacy,
  };
}

function canViewSection(
  isOwner: boolean,
  isFriend: boolean,
  toFriends: boolean,
  toOthers: boolean
): boolean {
  if (isOwner) return true;
  return isFriend ? toFriends : toOthers;
}

// ─── Reaction privacy lock ────────────────────────────────────────
// A reaction can be "locked" (private): visible ONLY to the reactor and the
// moment's owner; hidden from all other friends. We persist this WITHOUT a
// schema change by encoding it in the existing `type` column with a sentinel
// prefix (e.g. "locked:❤️"). The prefix never leaves the backend — every
// reader strips it and exposes a clean `type` plus a boolean `locked`.
export const LOCK_PREFIX = "locked:";
export function isReactionLocked(type: string | null | undefined): boolean {
  return typeof type === "string" && type.startsWith(LOCK_PREFIX);
}
export function baseReactionType(type: string | null | undefined): string {
  return isReactionLocked(type) ? (type as string).slice(LOCK_PREFIX.length) : (type ?? "");
}
export function lockedReactionType(type: string | null | undefined): string {
  return LOCK_PREFIX + baseReactionType(type);
}

// Map + visibility-filter a raw reactions array for a specific viewer.
// `ownerId` is the moment owner; locked reactions survive only for the reactor
// themselves or the owner.
export function formatReactions(rawReactions: any[], viewerId?: string, ownerId?: string, blockedIds: string[] = []) {
  const blockedSet = blockedIds.length > 0 ? new Set(blockedIds) : null;
  return (rawReactions ?? [])
    .filter((r: any) => !blockedSet || !blockedSet.has(r.user_id))
    .filter((r: any) => !isReactionLocked(r.type) || r.user_id === viewerId || ownerId === viewerId)
    .map((r: any) => ({
      userId: r.user_id,
      type: baseReactionType(r.type),
      locked: isReactionLocked(r.type),
      userAvatar:
        r.profiles?.avatar_url && String(r.profiles.avatar_url).length > 0
          ? r.profiles.avatar_url
          : undefined,
    }));
}

export function formatPost(p: any, viewerId?: string, blockedIds: string[] = []): any {
  // Friendship moments group everyone the owner befriended that day; expose the
  // parsed list so the client can render "Became friends with A, B and N others".
  const friends = p.type === FRIENDSHIP_TYPE ? parseFriendshipFriends(p) : undefined;
  // image_url may hold a single URL (legacy) or a JSON array of URLs (multi-image).
  const images = decodeImages(p.image_url);
  return {
    id: p.id,
    userId: p.user_id,
    user: p.profiles ? formatProfile(p.profiles) : null,
    type: p.type,
    content: p.content ?? undefined,
    friends,
    // `image` stays the FIRST url for full backward compatibility; `images` is
    // the complete list (present whenever there's at least one image).
    image: images[0] ?? undefined,
    images: images.length > 0 ? images : undefined,
    locationName: p.location ?? undefined,
    // Coordinates for check-in (location) moments so anyone who can see the
    // moment can open it on a map — same as location messages in chat.
    locationLat: p.location_lat ?? undefined,
    locationLng: p.location_lng ?? undefined,
    venueCategory: p.venue_category ?? undefined,
    musicTitle: p.music_title ?? undefined,
    musicArtist: p.music_artist ?? undefined,
    musicAlbum: p.music_album ?? undefined,
    musicMode: p.music_mode ?? undefined,
    activityType: p.activity_type ?? undefined,
    activityDuration: p.activity_duration ?? undefined,
    mealName: p.meal_name ?? undefined,
    sleepAction: p.sleep_action ?? undefined,
    sleepDuration: formatDuration(p.sleep_duration),
    reactions: formatReactions(p.reactions ?? [], viewerId, p.user_id, blockedIds),
    commentCount: p.comment_count ?? 0,
    createdAt: p.created_at,
    // Reshare ("Repath"): `repath_of` is the original moment id (absent until the
    // column exists). `original` is the nested original row, attached by the
    // route handler (attachOriginals) and formatted here one level deep.
    repathOf: p.repath_of ?? undefined,
    original: p.original ? formatPost(p.original, viewerId, blockedIds) : undefined,
    // Audience ("public" | "friends" | "close" | "private"). Absent until the
    // column exists; the client treats a missing value as "friends".
    audience: p.audience ?? undefined,
    // Whether new comments are turned off for this moment. Absent until the
    // `comments_disabled` column exists; treated as false (comments enabled).
    commentsDisabled: p.comments_disabled ?? false,
  };
}

// GET /api/search?q=...
usersRouter.get("/search", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  // Strip a leading "@" so "@ali" and "ali" search the same. PREFIX match
  // (starts-with) on username OR full_name — one letter already lists everyone
  // matching that prefix. This is GLOBAL discovery: it searches ALL users, not
  // just the viewer's friends. (Privacy still governs what moments they can see
  // once a profile is opened — this only finds the person.)
  const q = (c.req.query("q") ?? "").replace(/^@+/, "").trim();
  if (q.length < 1) return c.json({ data: [] });

  const userClient = createUserClient(token);
  const { data: profiles } = await userClient
    .from("profiles")
    .select("*")
    .or(`full_name.ilike.${q}%,username.ilike.${q}%`)
    .limit(30);

  // Fetch all friendships involving the current user
  const { data: myFriendships } = await userClient
    .from("friendships")
    .select("id, requester_id, receiver_id, status")
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);

  const friendshipByUser: Record<string, { id: string; status: string; isSender: boolean }> = {};
  for (const f of myFriendships ?? []) {
    const otherId = f.requester_id === userId ? f.receiver_id : f.requester_id;
    friendshipByUser[otherId] = { id: f.id, status: f.status, isSender: f.requester_id === userId };
  }

  // Hide users blocked in either direction from discovery results.
  const blockedSet = new Set(await getBlockedIds(userId));

  const results = (profiles ?? [])
    .filter((p: any) => !blockedSet.has(p.id))
    .map((p: any) => {
    const fs = friendshipByUser[p.id];
    let friendshipStatus: 'none' | 'pending_sent' | 'pending_received' | 'friends' = 'none';
    let friendshipId: string | undefined;
    if (fs) {
      friendshipId = fs.id;
      if (fs.status === 'accepted') {
        friendshipStatus = 'friends';
      } else if (fs.status === 'pending') {
        friendshipStatus = fs.isSender ? 'pending_sent' : 'pending_received';
      }
    }
    return { ...formatProfile(p), friendshipStatus, friendshipId };
  });

  return c.json({ data: results });
});

// GET /api/by-username/:username
// Resolve a tappable @mention to a real user. Mentions are stored in moment /
// comment text as the user's username (preferred) or their name with spaces
// stripped. We match case-insensitively on username first, then fall back to a
// space-stripped full_name match. Returns null data (200) when nothing matches
// so the client can stay inert without treating it as an error.
usersRouter.get("/by-username/:username", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const raw = (c.req.param("username") ?? "").replace(/^@+/, "").trim();
  if (!raw) return c.json({ data: null });

  const userClient = createUserClient(token);

  // 1) Exact (case-insensitive) username match.
  const { data: byUsername } = await userClient
    .from("profiles")
    .select("*")
    .ilike("username", raw)
    .limit(1)
    .maybeSingle();

  let match = byUsername;

  // 2) Fall back to a space-stripped full_name match (mentions of users with no
  //    username are inserted as their name without spaces).
  if (!match) {
    const { data: candidates } = await userClient
      .from("profiles")
      .select("*")
      .ilike("full_name", `%${raw}%`)
      .limit(20);
    const target = raw.toLowerCase();
    match =
      (candidates ?? []).find(
        (p: any) => (p.full_name ?? "").replace(/\s+/g, "").toLowerCase() === target
      ) ?? null;
  }

  if (!match) return c.json({ data: null });
  return c.json({ data: formatProfile(match, 0, 0, userId ?? undefined) });
});

// GET /api/username-check/:username
usersRouter.get("/username-check/:username", async (c) => {
  const { username } = c.req.param();
  const trimmed = username.toLowerCase().trim();
  if (!trimmed || trimmed.length < 3) {
    return c.json({ data: { available: false, reason: "Username must be at least 3 characters" } });
  }
  if (!/^[a-z0-9_]+$/.test(trimmed)) {
    return c.json({ data: { available: false, reason: "Only letters, numbers, and underscores allowed" } });
  }
  const { data } = await supabase.from("profiles").select("id").eq("username", trimmed).maybeSingle();
  return c.json({ data: { available: !data } });
});

// POST /api/setup-profile
usersRouter.post("/setup-profile", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = await c.req.json();
  const { username, name, email } = body as { username: string; name: string; email: string };

  if (!username || !name) {
    return c.json({ error: { message: "username and name are required" } }, 400);
  }

  const trimmedUsername = username.toLowerCase().trim();

  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", trimmedUsername)
    .neq("id", userId)
    .maybeSingle();

  if (existing) {
    return c.json({ error: { message: "Username already taken" } }, 409);
  }

  const userClient = createUserClient(token);

  const { data: profile, error } = await userClient
    .from("profiles")
    .upsert({ id: userId, username: trimmedUsername, full_name: name }, { onConflict: "id" })
    .select()
    .single();

  if (error) {
    console.error("Setup profile error - full details:", {
      message: error.message,
      code: error.code,
      details: (error as any).details,
      hint: (error as any).hint,
      userId,
      username: trimmedUsername,
    });
    return c.json({ error: { message: "Failed to create profile", supabaseError: error.message } }, 500);
  }

  return c.json({ data: formatProfile(profile) }, 201);
});

// GET /api/me
usersRouter.get("/me", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const userClient = createUserClient(token);

  const [postsResult, friendsResult] = await Promise.all([
    userClient.from("posts").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabaseAdmin.from("friendships").select("id", { count: "exact", head: true }).eq("status", "accepted").or(`requester_id.eq.${userId},receiver_id.eq.${userId}`),
  ]);

  return c.json({ data: formatProfile(user, postsResult.count ?? 0, friendsResult.count ?? 0, userId) });
});

// POST /api/set-gender — one-time gender selection for users who signed up
// before gender was mandatory. Refuses to overwrite an existing gender so it
// can never be edited once set.
usersRouter.post("/set-gender", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = await c.req.json().catch(() => ({}));
  const gender = body?.gender;
  if (gender !== "Male" && gender !== "Female") {
    return c.json({ error: { message: "Gender must be Male or Female" } }, 400);
  }
  if ((user as any).gender) {
    return c.json({ error: { message: "Gender already set" } }, 409);
  }

  // Use service role so a missing/strict profiles UPDATE policy cannot block
  // this one-time write after we have already authenticated the caller.
  const { data: updated, error } = await supabaseAdmin
    .from("profiles")
    .update({ gender })
    .eq("id", userId)
    .select()
    .single();

  if (error) {
    console.error("[users] set-gender failed:", error.message);
    return c.json({ error: { message: "Failed to set gender" } }, 500);
  }
  return c.json({ data: formatProfile(updated, 0, 0, userId) });
});

// PUT /api/me
usersRouter.put("/me", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = await c.req.json();

  if (body.username) {
    const trimmedUsername = body.username.toLowerCase().trim();
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", trimmedUsername)
      .neq("id", userId)
      .maybeSingle();
    if (existing) return c.json({ error: { message: "Username already taken" } }, 409);
    body.username = trimmedUsername;
  }

  const userClient = createUserClient(token);
  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.full_name = body.name;
  if (body.username !== undefined) updateData.username = body.username;
  if (body.bio !== undefined) updateData.bio = body.bio;
  if (body.location !== undefined) updateData.location = body.location;
  // birthday and gender are intentionally NOT editable here — they are fixed at
  // signup. Only the age/zodiac visibility toggles can be changed.
  if (body.showAge !== undefined) updateData.show_age = !!body.showAge;
  if (body.showZodiac !== undefined) updateData.show_zodiac = !!body.showZodiac;
  if (body.coverPhoto !== undefined) updateData.cover_url = body.coverPhoto;
  if (body.avatar !== undefined) updateData.avatar_url = body.avatar;
  if (body.push_token !== undefined) updateData.push_token = body.push_token;
  if (body.pushNotificationsEnabled !== undefined) {
    updateData.push_notifications_enabled = Boolean(body.pushNotificationsEnabled);
    if (body.pushNotificationsEnabled === false) {
      updateData.push_token = null;
    }
  }
  if (body.emailNotificationsEnabled !== undefined) {
    updateData.email_notifications_enabled = Boolean(body.emailNotificationsEnabled);
  }
  if (body.preferredLanguage !== undefined) {
    updateData.preferred_language = body.preferredLanguage === "ar" ? "ar" : "en";
  }
  if (body.showFriendsToFriends !== undefined) updateData.show_friends_to_friends = !!body.showFriendsToFriends;
  if (body.showFriendsToOthers !== undefined) updateData.show_friends_to_others = !!body.showFriendsToOthers;
  if (body.showPostsToFriends !== undefined) updateData.show_posts_to_friends = !!body.showPostsToFriends;
  if (body.showPostsToOthers !== undefined) updateData.show_posts_to_others = !!body.showPostsToOthers;
  if (body.showMomentsToFriends !== undefined) updateData.show_moments_to_friends = !!body.showMomentsToFriends;
  if (body.showMomentsToOthers !== undefined) updateData.show_moments_to_others = !!body.showMomentsToOthers;

  if (Object.keys(updateData).length === 0) {
    return c.json({ error: { message: "No fields to update" } }, 400);
  }

  // Use service role for profile writes so missing/strict UPDATE policies (and
  // newly-added columns like show_age / show_zodiac) cannot silently block the
  // age & zodiac visibility toggles after the caller is already authenticated.
  const { data: updated, error } = await supabaseAdmin
    .from("profiles")
    .update(updateData)
    .eq("id", userId)
    .select()
    .single();

  if (error) {
    console.error("[users] PUT /me failed:", error.message, error.code);
    return c.json({ error: { message: "Update failed" } }, 500);
  }

  // Auto-create system moments when the avatar / cover photo ACTUALLY changes.
  // We compare against the values the profile had before this update.
  const oldAvatar = (user as any).avatar_url ?? null;
  const oldCover = (user as any).cover_url ?? null;
  if (body.avatar !== undefined && body.avatar && body.avatar !== oldAvatar) {
    await ensureAvatarChangeMoment(userId, body.avatar);
  }
  if (body.coverPhoto !== undefined && body.coverPhoto && body.coverPhoto !== oldCover) {
    await ensureCoverChangeMoment(userId, body.coverPhoto);
  }

  const [postsResult, friendsResult] = await Promise.all([
    userClient.from("posts").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabaseAdmin.from("friendships").select("id", { count: "exact", head: true }).eq("status", "accepted").or(`requester_id.eq.${userId},receiver_id.eq.${userId}`),
  ]);

  return c.json({ data: formatProfile(updated, postsResult.count ?? 0, friendsResult.count ?? 0, userId) });
});

import {
  suspendAccountForDeletion,
  permanentlyDeleteUser,
  DELETION_SUSPEND_REASON,
} from "../lib/account-deletion";

// POST /api/me/deletion-request — immediately suspend account for 30-day deletion window.
usersRouter.post("/me/deletion-request", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = await c.req.json().catch(() => ({}));
  const reason = body?.reason ? String(body.reason).trim().slice(0, 1000) : null;

  const result = await suspendAccountForDeletion(userId, reason);
  if (!result.ok) {
    return c.json({ error: { message: result.message } }, 500);
  }

  const now = new Date().toISOString();
  return c.json({
    data: {
      status: "suspended",
      suspendedAt: now,
      message:
        "Your account is suspended for 30 days. Sign in within 30 days to reactivate. After that, it will be permanently deleted.",
    },
  });
});

usersRouter.get("/me/deletion-request", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("status, suspended_at, suspended_reason")
    .eq("id", userId)
    .maybeSingle();

  if (
    profile?.status === "suspended" &&
    profile.suspended_reason === DELETION_SUSPEND_REASON
  ) {
    return c.json({
      data: {
        status: "suspended",
        suspendedAt: profile.suspended_at,
      },
    });
  }

  return c.json({ data: null });
});

// DELETE /api/me — permanently delete (service / cron only; users use deletion-request).
usersRouter.delete("/me", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const result = await permanentlyDeleteUser(userId);
  if (!result.ok) {
    console.error("[users] DELETE /me failed:", result.error);
    return c.json({ error: { message: "Failed to delete account" } }, 500);
  }

  return c.body(null, 204);
});

// GET /api/:id
usersRouter.get("/:id", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();

  // Hide profiles that are blocked in either direction.
  if (userId && id !== userId) {
    const blocked = await getBlockedIds(userId);
    if (blocked.includes(id)) {
      return c.json({ error: { message: "User not found" } }, 404);
    }
  }

  const userClient = createUserClient(token);
  const { data: targetProfile } = await userClient.from("profiles").select("*").eq("id", id).single();
  if (!targetProfile) return c.json({ error: { message: "User not found" } }, 404);

  const [postsResult, friendsResult] = await Promise.all([
    userClient.from("posts").select("id", { count: "exact", head: true }).eq("user_id", id),
    // True total friend count — uses the admin client so RLS doesn't restrict the
    // count to only the friendships the *viewer* is part of (which made the count
    // differ per viewer). Same number for everyone now.
    supabaseAdmin.from("friendships").select("id", { count: "exact", head: true }).eq("status", "accepted").or(`requester_id.eq.${id},receiver_id.eq.${id}`),
  ]);

  return c.json({ data: formatProfile(targetProfile, postsResult.count ?? 0, friendsResult.count ?? 0, userId ?? undefined) });
});

async function areFriends(a: string, b: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("friendships")
    .select("id")
    .eq("status", "accepted")
    .or(`and(requester_id.eq.${a},receiver_id.eq.${b}),and(requester_id.eq.${b},receiver_id.eq.${a})`)
    .maybeSingle();
  return !!data;
}

// GET /api/:id/friends — list this user's friends (gated by privacy settings).
usersRouter.get("/:id/friends", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  if (await getBlockedIds(userId).then((ids) => ids.includes(id))) {
    return c.json({ error: { message: "User not found" } }, 404);
  }

  const { data: profile } = await supabaseAdmin.from("profiles").select("*").eq("id", id).single();
  if (!profile) return c.json({ error: { message: "User not found" } }, 404);

  const isOwner = userId === id;
  const isFriend = isOwner ? true : await areFriends(userId, id);
  const allowed = canViewSection(
    isOwner,
    isFriend,
    profile.show_friends_to_friends ?? true,
    profile.show_friends_to_others ?? false
  );
  if (!allowed) {
    return c.json({ error: { message: "This friends list is private" } }, 403);
  }

  const { data: friendships } = await supabaseAdmin
    .from("friendships")
    .select("requester_id, receiver_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${id},receiver_id.eq.${id}`);

  const friendIds = (friendships ?? []).map((f: any) =>
    f.requester_id === id ? f.receiver_id : f.requester_id
  );

  if (friendIds.length === 0) return c.json({ data: [] });

  const blocked = new Set(await getBlockedIds(userId));
  const visibleIds = friendIds.filter((fid: string) => !blocked.has(fid));
  if (visibleIds.length === 0) return c.json({ data: [] });

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .in("id", visibleIds);

  return c.json({
    data: (profiles ?? []).map((p: any) => formatProfile(p, 0, 0, userId)),
  });
});

// GET /api/:id/posts
usersRouter.get("/:id/posts", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const section = (c.req.query("section") ?? "moments").toLowerCase(); // posts | moments

  // If this profile is blocked (either direction), don't expose their moments.
  const blockedIds = userId ? await getBlockedIds(userId) : [];
  if (blockedIds.includes(id)) return c.json({ data: [] });

  const { data: ownerProfile } = await supabaseAdmin.from("profiles").select("*").eq("id", id).single();
  if (!ownerProfile) return c.json({ data: [] });

  const isOwner = !!userId && userId === id;
  const isFriend = isOwner ? true : userId ? await areFriends(userId, id) : false;

  if (section === "posts") {
    const allowed = canViewSection(
      isOwner,
      isFriend,
      ownerProfile.show_posts_to_friends ?? true,
      ownerProfile.show_posts_to_others ?? true
    );
    if (!allowed) return c.json({ error: { message: "Posts are private" } }, 403);
  } else {
    const allowed = canViewSection(
      isOwner,
      isFriend,
      ownerProfile.show_moments_to_friends ?? true,
      ownerProfile.show_moments_to_others ?? true
    );
    if (!allowed) return c.json({ error: { message: "Moments are private" } }, 403);
  }

  const userClient = createUserClient(token);
  const { data: posts } = await userClient
    .from("posts")
    .select("*, profiles(*), reactions(user_id, type, profiles:user_id(avatar_url))")
    .eq("user_id", id)
    .order("created_at", { ascending: false });

  const all = posts ?? [];

  let visible = all;
  if (userId && userId !== id) {
    let isClose = false;
    if (isFriend) {
      let { data: star } = await supabaseAdmin
        .from("close_friends")
        .select("friend_id")
        .eq("user_id", id)
        .eq("friend_id", userId)
        .maybeSingle();
      if (!star) {
        ({ data: star } = await supabaseAdmin
          .from("close_friends")
          .select("friend_id")
          .eq("owner_id", id)
          .eq("friend_id", userId)
          .maybeSingle());
      }
      isClose = !!star;
    }

    visible = all.filter((p: any) => {
      const audience = p.audience ?? "friends";
      if (audience === "public") return true;
      if (audience === "private") return false;
      if (audience === "close") return isClose;
      return isFriend;
    });
  }

  // "Posts" = moments that include media or written content; "Moments" = full timeline.
  if (section === "posts") {
    visible = visible.filter(
      (p: any) => !!(p.content || p.image_url || p.location || p.type === "location")
    );
  }

  const formatted = visible.map((p) => formatPost(p, userId ?? undefined, blockedIds));
  await refreshFriendshipAvatars(formatted);
  return c.json({ data: formatted });
});

export { usersRouter };
