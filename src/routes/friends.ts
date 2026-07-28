import { Hono } from "hono";
import { createUserClient, supabaseAdmin } from "../supabase";
import { sendPushNotification, getPushToken } from "../lib/push";
import type { HonoVariables } from "../types";

const friendsRouter = new Hono<{ Variables: HonoVariables }>();

function formatProfile(p: any) {
  return {
    id: p.id,
    name: p.full_name ?? "",
    username: p.username ?? "",
    avatar: p.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.id}`,
    bio: p.bio ?? "",
    location: p.location ?? "",
    birthday: p.birthday ?? "",
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

  const { data: acceptedFriendships } = await userClient
    .from("friendships")
    .select("id, requester_id, receiver_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);

  const friendIds = (acceptedFriendships ?? []).map((f: any) =>
    f.requester_id === userId ? f.receiver_id : f.requester_id
  );

  const { data: pendingFriendships } = await userClient
    .from("friendships")
    .select("id, requester_id, created_at")
    .eq("receiver_id", userId)
    .eq("status", "pending");

  const pendingRequesterIds = (pendingFriendships ?? []).map((f: any) => f.requester_id);

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

  const friends = friendIds.map((id: string) => profileMap[id]).filter(Boolean).map(formatProfile);
  const requests = (pendingFriendships ?? []).map((f: any) => ({
    id: f.id,
    user: profileMap[f.requester_id] ? formatProfile(profileMap[f.requester_id]) : { id: f.requester_id, name: "Unknown" },
    mutualFriends: 0,
    createdAt: f.created_at,
  }));

  const { data: blocks } = await userClient
    .from("user_blocks")
    .select("blocked_id")
    .eq("blocker_id", userId);
  const blockedIds = (blocks ?? []).map((b: any) => b.blocked_id);

  const excludeIds = [userId, ...friendIds, ...pendingRequesterIds, ...pendingSentIds, ...blockedIds];

  // Prefer suggestions who share mutual friends
  let suggestedProfiles: any[] = [];
  if (friendIds.length > 0) {
    const { data: friendOfFriends } = await supabaseAdmin
      .from("friendships")
      .select("requester_id, receiver_id")
      .eq("status", "accepted")
      .or(friendIds.map((id) => `requester_id.eq.${id},receiver_id.eq.${id}`).join(","))
      .limit(200);

    const mutualCount: Record<string, number> = {};
    const excludeSet = new Set(excludeIds);
    for (const f of friendOfFriends ?? []) {
      for (const candidate of [f.requester_id, f.receiver_id]) {
        if (excludeSet.has(candidate) || friendIds.includes(candidate)) continue;
        mutualCount[candidate] = (mutualCount[candidate] ?? 0) + 1;
      }
    }
    const ranked = Object.entries(mutualCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, count]) => ({ id, count }));

    if (ranked.length > 0) {
      const { data: profiles } = await userClient
        .from("profiles")
        .select("*")
        .in(
          "id",
          ranked.map((r) => r.id)
        );
      const countMap = Object.fromEntries(ranked.map((r) => [r.id, r.count]));
      suggestedProfiles = (profiles ?? [])
        .map((p: any) => ({ ...formatProfile(p), mutualFriends: countMap[p.id] ?? 0 }))
        .sort((a: any, b: any) => (b.mutualFriends ?? 0) - (a.mutualFriends ?? 0));
    }
  }

  if (suggestedProfiles.length < 5) {
    const already = new Set([
      ...excludeIds,
      ...suggestedProfiles.map((p: any) => p.id),
    ]);
    const { data: fallback } = await userClient
      .from("profiles")
      .select("*")
      .not("id", "in", `(${[...already].join(",")})`)
      .limit(8);
    for (const p of fallback ?? []) {
      if (suggestedProfiles.length >= 8) break;
      suggestedProfiles.push({ ...formatProfile(p), mutualFriends: 0 });
    }
  }

  // Enrich friend requests with mutual friend counts
  const requestsWithMutual = await Promise.all(
    requests.map(async (req: any) => {
      try {
        const { data: theirFriends } = await supabaseAdmin
          .from("friendships")
          .select("requester_id, receiver_id")
          .eq("status", "accepted")
          .or(`requester_id.eq.${req.user.id},receiver_id.eq.${req.user.id}`);
        const theirIds = new Set(
          (theirFriends ?? []).map((f: any) =>
            f.requester_id === req.user.id ? f.receiver_id : f.requester_id
          )
        );
        const mutualFriends = friendIds.filter((id) => theirIds.has(id)).length;
        return { ...req, mutualFriends };
      } catch {
        return req;
      }
    })
  );

  return c.json({
    data: {
      friends,
      requests: requestsWithMutual,
      suggested: suggestedProfiles.slice(0, 8),
    },
  });
});

friendsRouter.post("/request/:userId", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { userId: targetId } = c.req.param();
  if (targetId === userId) return c.json({ error: { message: "Cannot friend yourself" } }, 400);

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

  // Cross-user notification row — use service role (RLS targets recipient's user_id)
  const { error: notifError } = await supabaseAdmin.from("notifications").insert({
    user_id: targetId,
    from_user_id: userId,
    type: "friend_request",
    message: `${user.full_name} sent you a friend request`,
    read: false,
  });
  if (notifError) {
    console.error("[notifications] friend_request insert error:", notifError.message);
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

  const { data: friendship } = await userClient.from("friendships").select("*").eq("id", id).maybeSingle();
  if (!friendship || friendship.receiver_id !== userId) {
    return c.json({ error: { message: "Not found" } }, 404);
  }
  if (friendship.status !== "pending") {
    return c.json({ error: { message: "Friend request is not pending" } }, 400);
  }

  const { data: updated, error: acceptError } = await userClient
    .from("friendships")
    .update({ status: "accepted" })
    .eq("id", id)
    .eq("status", "pending")
    .select()
    .single();

  if (acceptError || !updated) {
    console.error("[friends] accept error:", acceptError?.message);
    return c.json({ error: { message: "Failed to accept request" } }, 500);
  }

  const { error: notifError } = await supabaseAdmin.from("notifications").insert({
    user_id: friendship.requester_id,
    from_user_id: userId,
    type: "friend_accepted",
    message: `${user.full_name} accepted your friend request`,
    read: false,
  });
  if (notifError) {
    console.error("[notifications] friend_accepted insert error:", notifError.message);
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

  // Target's full friend list requires service role (RLS only exposes caller's rows)
  const [currentUserFriendships, targetUserFriendships] = await Promise.all([
    userClient
      .from("friendships")
      .select("requester_id, receiver_id")
      .eq("status", "accepted")
      .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`),
    supabaseAdmin
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

  const { error: deleteError } = await userClient.from("friendships").delete().eq("id", id);
  if (deleteError) {
    console.error("[friends] delete error:", deleteError.message);
    return c.json({ error: { message: "Failed to remove friendship" } }, 500);
  }
  return c.body(null, 204);
});

export { friendsRouter };
