import { Hono } from "hono";
import { createUserClient } from "../supabase";
import type { HonoVariables } from "../types";

const notificationsRouter = new Hono<{ Variables: HonoVariables }>();

notificationsRouter.get("/", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const userClient = createUserClient(token);
  const { data: notifications } = await userClient
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  const fromUserIds = [...new Set((notifications ?? []).map((n: any) => n.from_user_id).filter(Boolean))];
  let profileMap: Record<string, any> = {};
  if (fromUserIds.length > 0) {
    const { data: profiles } = await userClient.from("profiles").select("*").in("id", fromUserIds as string[]);
    for (const p of profiles ?? []) profileMap[p.id] = p;
  }

  // For friend_request notifications, fetch the friendship ID so mobile can accept/decline
  const friendRequestNotifs = (notifications ?? []).filter((n: any) => n.type === 'friend_request');
  let friendshipMap: Record<string, string> = {};
  if (friendRequestNotifs.length > 0) {
    for (const n of friendRequestNotifs) {
      if (n.from_user_id) {
        const { data: fs } = await userClient
          .from("friendships")
          .select("id, status")
          .eq("requester_id", n.from_user_id)
          .eq("receiver_id", userId)
          .eq("status", "pending")
          .maybeSingle();
        if (fs) friendshipMap[n.id] = fs.id;
      }
    }
  }

  return c.json({
    data: (notifications ?? []).map((n: any) => ({
      id: n.id,
      type: n.type,
      user: n.from_user_id && profileMap[n.from_user_id]
        ? {
            id: profileMap[n.from_user_id].id,
            name: profileMap[n.from_user_id].full_name,
            avatar: profileMap[n.from_user_id].avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${n.from_user_id}`,
          }
        : { id: "system", name: "Path+", avatar: "" },
      message: n.message,
      postId: n.post_id ?? undefined,
      friendshipId: friendshipMap[n.id] ?? undefined,
      read: n.read,
      createdAt: n.created_at,
    })),
  });
});

notificationsRouter.post("/:id/read", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const userClient = createUserClient(token);
  const { data: updated, error } = await userClient
    .from("notifications")
    .update({ read: true })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[notifications] mark read error:", error.message);
    return c.json({ error: { message: "Failed to mark notification as read" } }, 500);
  }
  if (!updated) {
    return c.json({ error: { message: "Notification not found" } }, 404);
  }
  return c.body(null, 204);
});

export { notificationsRouter };
