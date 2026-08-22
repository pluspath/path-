import { Hono } from "hono";
import { createUserClient, supabaseAdmin } from "../supabase";
import { sendPushNotification, getPushToken } from "../lib/push";
import { ensureFriendshipMoments } from "../lib/systemMoments";
import { getBlockedIds, isBlocked } from "../lib/blocks";
import type { HonoVariables } from "../types";

const friendsRouter = new Hono<{ Variables: HonoVariables }>();

// Close friends ("starred" friends) are PRIVATE to the owner.
// Schema drift: some DBs use `user_id`, others use `owner_id`. Support both.
async function getCloseFriendIds(userClient: any, ownerId: string): Promise<Set<string>> {
  try {
    let { data, error } = await userClient
      .from("close_friends")
      .select("friend_id")
      .eq("user_id", ownerId);

    if (error && /owner_id|column|user_id/i.test(error.message ?? "")) {
      ({ data, error } = await userClient
        .from("close_friends")
        .select("friend_id")
        .eq("owner_id", ownerId));
    }

    if (error || !data) return new Set();
    return new Set(data.map((r: any) => r.friend_id));
  } catch {
    return new Set();
  }
}

async function upsertCloseFriend(userClient: any, ownerId: string, friendId: string) {
  // Prefer user_id (matches mobile + common production bootstrap).
  let { error } = await userClient
    .from("close_friends")
    .upsert({ user_id: ownerId, friend_id: friendId }, { onConflict: "user_id,friend_id" });

  if (!error) return null;

  if (/owner_id|column|user_id|onConflict|conflict/i.test(error.message ?? "")) {
    // Try owner_id schema, then plain inserts.
    ({ error } = await userClient
      .from("close_friends")
      .upsert({ owner_id: ownerId, friend_id: friendId }, { onConflict: "owner_id,friend_id" }));
    if (!error) return null;

    ({ error } = await userClient
      .from("close_friends")
      .insert({ user_id: ownerId, friend_id: friendId }));
    if (!error || /duplicate|unique/i.test(error.message ?? "")) return null;

    ({ error } = await userClient
      .from("close_friends")
      .insert({ owner_id: ownerId, friend_id: friendId }));
    if (!error || /duplicate|unique/i.test(error.message ?? "")) return null;
  }

  return error;
}

async function deleteCloseFriend(userClient: any, ownerId: string, friendId: string) {
  await userClient.from("close_friends").delete().eq("user_id", ownerId).eq("friend_id", friendId);
  await userClient.from("close_friends").delete().eq("owner_id", ownerId).eq("friend_id", friendId);
}

function formatProfile(p: any) {
  return {
    id: p.id,
    name: p.full_name ?? "",
    username: p.username ?? "",
    avatar: p.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.id}`,
    bio: p.bio ?? "",
    location: p.location ?? "",
    // Raw birthday is private — never exposed in friend lists / suggestions.
    birthday: "",
    gender: p.gender ?? "",
    coverPhoto: p.cover_url ?? "https://images.unsplash.com/photo-1519638399535-1b036603ac77?w=800",
    joinDate: p.created_at ?? new Date().toISOString(),
    friendCount: 0,
    postCount: 0,
    momentCount: 0,
  };
}

friendsRouter.get("/", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const userClient = createUserClient(token);

  // Blocked-in-either-direction ids are hidden from friends, requests, and
  // suggestions throughout this response.
  const blockedSet = new Set(await getBlockedIds(userId));

  const { data: acceptedFriendships } = await userClient
    .from("friendships")
    .select("id, requester_id, receiver_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);

  const friendIds = (acceptedFriendships ?? [])
    .map((f: any) => (f.requester_id === userId ? f.receiver_id : f.requester_id))
    .filter((id: string) => !blockedSet.has(id));

  // Map each friend's id -> the friendship row id, so the client can unfriend.
  const friendshipIdByFriend: Record<string, string> = {};
  for (const f of acceptedFriendships ?? []) {
    const otherId = f.requester_id === userId ? f.receiver_id : f.requester_id;
    friendshipIdByFriend[otherId] = f.id;
  }

  // Which of my friends I've privately starred as close friends.
  const closeFriendSet = await getCloseFriendIds(userClient, userId);

  const { data: pendingFriendships } = await userClient
    .from("friendships")
    .select("id, requester_id, created_at")
    .eq("receiver_id", userId)
    .eq("status", "pending");

  const pendingRequesterIds = (pendingFriendships ?? [])
    .map((f: any) => f.requester_id)
    .filter((id: string) => !blockedSet.has(id));

  const { data: pendingSentFriendships } = await userClient
    .from("friendships")
    .select("id, receiver_id")
    .eq("requester_id", userId)
    .eq("status", "pending");

  const pendingSentIds = (pendingSentFriendships ?? []).map((f: any) => f.receiver_id);

  const allIds = [...new Set([...friendIds, ...pendingRequesterIds])];

  let profileMap: Record<string, any> = {};
  if (allIds.length > 0) {
    const { data: profiles } = await userClient.from("profiles").select("*").in("id", allIds);
    for (const p of profiles ?? []) profileMap[p.id] = p;
  }

  const friends = friendIds
    .map((id: string) => profileMap[id])
    .filter(Boolean)
    .map((p: any) => ({
      ...formatProfile(p),
      friendshipStatus: "friends" as const,
      friendshipId: friendshipIdByFriend[p.id],
      // The star state — single source of truth, read from `close_friends`.
      isCloseFriend: closeFriendSet.has(p.id),
    }));
  const requests = (pendingFriendships ?? [])
    .filter((f: any) => !blockedSet.has(f.requester_id))
    .map((f: any) => ({
      id: f.id,
      user: profileMap[f.requester_id] ? formatProfile(profileMap[f.requester_id]) : { id: f.requester_id, name: "Unknown" },
      mutualFriends: 0,
      createdAt: f.created_at,
    }));

  const excludeIds = [userId, ...friendIds, ...pendingRequesterIds, ...pendingSentIds, ...blockedSet];
  const { data: suggested } = await userClient
    .from("profiles")
    .select("*")
    .not("id", "in", `(${excludeIds.join(",")})`)
    .limit(5);

  return c.json({ data: { friends, requests, suggested: (suggested ?? []).map(formatProfile) } });
});

friendsRouter.post("/request/:userId", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { userId: targetId } = c.req.param();
  if (targetId === userId) return c.json({ error: { message: "Cannot friend yourself" } }, 400);

  // Can't send a request to (or from) someone in a block relationship.
  if (await isBlocked(userId, targetId)) {
    return c.json({ error: { message: "Unable to send request" } }, 403);
  }

  const userClient = createUserClient(token);

  const { data: existing } = await userClient
    .from("friendships")
    .select("id")
    .or(`and(requester_id.eq.${userId},receiver_id.eq.${targetId}),and(requester_id.eq.${targetId},receiver_id.eq.${userId})`)
    .maybeSingle();

  if (existing) return c.json({ error: { message: "Friend request already exists" } }, 409);

  const { data: friendship, error } = await userClient
    .from("friendships")
    .insert({ requester_id: userId, receiver_id: targetId, status: "pending" })
    .select()
    .single();

  if (error) return c.json({ error: { message: "Failed to send request" } }, 500);

  // Insert the in-app notification with the admin client: the sender is
  // writing a row owned by the recipient, which RLS on userClient blocks.
  try {
    await supabaseAdmin.from("notifications").insert({
      user_id: targetId,
      from_user_id: userId,
      type: "friend_request",
      message: `${user.full_name} sent you a friend request`,
      read: false,
    });
  } catch (e) {
    console.error("[notifications] friend_request insert error:", e);
  }

  // Send push notification to target user
  try {
    const pushToken = await getPushToken(supabaseAdmin, targetId);
    await sendPushNotification(
      pushToken,
      "Friend Request",
      `${user.full_name} sent you a friend request`,
      { type: "friend_request", fromUserId: userId }
    );
  } catch (e) {
    console.error("[push] friend request notification error:", e);
  }

  return c.json({ data: friendship }, 201);
});

friendsRouter.post("/accept/:id", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const userClient = createUserClient(token);

  const { data: friendship } = await userClient.from("friendships").select("*").eq("id", id).single();
  if (!friendship || friendship.receiver_id !== userId) {
    return c.json({ error: { message: "Not found" } }, 404);
  }

  const { data: updated } = await userClient
    .from("friendships")
    .update({ status: "accepted" })
    .eq("id", id)
    .select()
    .single();

  // Create the reciprocal "Became friends with X" system moments for both
  // users, timestamped to this accept. Idempotent per pair.
  await ensureFriendshipMoments(friendship.requester_id, userId);

  // Notify the requester that their friend request was accepted. Use the
  // admin client since this row is owned by the requester, not the accepter,
  // and RLS on userClient would silently block the insert.
  try {
    await supabaseAdmin.from("notifications").insert({
      user_id: friendship.requester_id,
      from_user_id: userId,
      type: "friend_accepted",
      message: `${user.full_name} accepted your friend request`,
      read: false,
    });
  } catch (e) {
    console.error("[notifications] friend_accepted insert error:", e);
  }

  // Also notify the ACCEPTER (this user) so BOTH people get a Notifications
  // entry the moment the friendship forms — not just the requester.
  try {
    const { data: requesterProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", friendship.requester_id)
      .maybeSingle();
    const requesterName = requesterProfile?.full_name ?? "Someone";
    await supabaseAdmin.from("notifications").insert({
      user_id: userId,
      from_user_id: friendship.requester_id,
      type: "now_friends",
      message: `You are now friends with ${requesterName}`,
      read: false,
    });
  } catch (e) {
    console.error("[notifications] now_friends insert error:", e);
  }

  try {
    const pushToken = await getPushToken(supabaseAdmin, friendship.requester_id);
    await sendPushNotification(
      pushToken,
      "Friend Request Accepted",
      `${user.full_name} accepted your friend request`,
      { type: "friend_accepted", fromUserId: userId }
    );
  } catch (e) {
    console.error("[push] friend accepted notification error:", e);
  }

  return c.json({ data: updated });
});

friendsRouter.get("/status/:userId", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { userId: targetId } = c.req.param();
  const userClient = createUserClient(token);

  const { data: friendship } = await userClient
    .from("friendships")
    .select("id, requester_id, receiver_id, status")
    .or(`and(requester_id.eq.${userId},receiver_id.eq.${targetId}),and(requester_id.eq.${targetId},receiver_id.eq.${userId})`)
    .maybeSingle();

  let status: "none" | "pending_sent" | "pending_received" | "friends" = "none";
  let friendshipId: string | null = null;

  if (friendship) {
    friendshipId = friendship.id;
    if (friendship.status === "accepted") {
      status = "friends";
    } else if (friendship.status === "pending") {
      status = friendship.requester_id === userId ? "pending_sent" : "pending_received";
    }
  }

  const [currentUserFriendships, targetUserFriendships] = await Promise.all([
    userClient
      .from("friendships")
      .select("requester_id, receiver_id")
      .eq("status", "accepted")
      .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`),
    userClient
      .from("friendships")
      .select("requester_id, receiver_id")
      .eq("status", "accepted")
      .or(`requester_id.eq.${targetId},receiver_id.eq.${targetId}`),
  ]);

  const currentFriendIds = new Set(
    (currentUserFriendships.data ?? []).map((f: any) =>
      f.requester_id === userId ? f.receiver_id : f.requester_id
    )
  );
  const targetFriendIds = (targetUserFriendships.data ?? []).map((f: any) =>
    f.requester_id === targetId ? f.receiver_id : f.requester_id
  );
  const mutualFriends = targetFriendIds.filter((id: string) => currentFriendIds.has(id)).length;

  return c.json({ data: { status, friendshipId, mutualFriends } });
});

friendsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const userClient = createUserClient(token);

  const { data: friendship } = await userClient.from("friendships").select("*").eq("id", id).maybeSingle();
  if (!friendship) return c.body(null, 204);

  if (friendship.requester_id !== userId && friendship.receiver_id !== userId) {
    return c.json({ error: { message: "Unauthorized" } }, 403);
  }

  await userClient.from("friendships").delete().eq("id", id);
  return c.body(null, 204);
});

// GET /api/friends/close-ids — the ids of friends I've starred as close
// friends. Single source of truth for the home timeline's STAR filter.
// Returns [] (never errors) if the close_friends table isn't set up yet.
friendsRouter.get("/close-ids", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  // Service role so RLS / column quirks can't return an empty list after a successful star.
  const set = await getCloseFriendIds(supabaseAdmin, userId);
  return c.json({ data: Array.from(set) });
});

// POST /api/friends/close/:userId — privately star a friend as a close friend.
friendsRouter.post("/close/:userId", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const targetId = c.req.param("userId");
  if (!targetId || targetId === userId) {
    return c.json({ error: { message: "Cannot star yourself" } }, 400);
  }

  // Prefer service role so missing RLS policies can't undo the optimistic UI.
  const db = supabaseAdmin;
  const error = await upsertCloseFriend(db, userId, targetId);

  if (error) {
    if (/close_friends|relation|table|schema/i.test(error.message ?? "")) {
      return c.json({ error: { message: "Close Friends isn't set up yet." } }, 400);
    }
    console.error("[friends] close upsert failed:", error.message);
    return c.json({ error: { message: "Failed to update close friend" } }, 500);
  }
  return c.json({ data: { isCloseFriend: true } });
});

// DELETE /api/friends/close/:userId — remove the private star.
friendsRouter.delete("/close/:userId", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const targetId = c.req.param("userId");
  await deleteCloseFriend(supabaseAdmin, userId, targetId);
  return c.json({ data: { isCloseFriend: false } });
});

export { friendsRouter };
