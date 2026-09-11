import { Hono } from "hono";
import { supabaseAdmin } from "../supabase";
import { getBlockedIds } from "../lib/blocks";
import {
  getPushTokensForUser,
  getPushStatusForUser,
  sendPushNotificationDetailed,
} from "../lib/push";
import { resolveAvatarUrl } from "../lib/avatar";
import type { HonoVariables } from "../types";

const notificationsRouter = new Hono<{ Variables: HonoVariables }>();

/**
 * POST /api/notifications/test — authenticated self-test push (same as /api/me/push-test).
 * Protected: requires Bearer session. Sends only to the caller's devices.
 */
notificationsRouter.post("/test", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const status = await getPushStatusForUser(supabaseAdmin, userId);

  if (!status.pushEnabledGlobally) {
    return c.json({
      data: {
        ok: false,
        step: "push_disabled_globally",
        message: "Push notifications are disabled in Admin → External Services.",
        ...status,
      },
    });
  }

  if (!status.pushEnabledForUser) {
    return c.json({
      data: {
        ok: false,
        step: "push_disabled_user",
        message: "Push notifications are turned off in your account settings.",
        ...status,
      },
    });
  }

  const tokens = await getPushTokensForUser(supabaseAdmin, userId);
  if (tokens.length === 0) {
    return c.json({
      data: {
        ok: false,
        step: "no_tokens",
        message:
          "No active push token found. Open the app on a physical iPhone, allow notifications, stay signed in, then try again.",
        activeDeviceCount: 0,
        ...status,
      },
    });
  }

  console.log(
    `[push-test] /api/notifications/test user=${userId.slice(0, 8)}… devices=${tokens.length}`
  );

  const results = await Promise.all(
    tokens.map((token) =>
      sendPushNotificationDetailed(
        token,
        "Path+ Test Notification",
        "Push Notifications are working correctly.",
        { type: "test" },
        supabaseAdmin,
        { waitForReceipt: true }
      )
    )
  );

  const ok = results.some((r) => r.ok);
  return c.json({
    data: {
      ok,
      step: ok ? "delivered" : "delivery_failed",
      message: ok
        ? "Test notification sent successfully."
        : results[0]?.message ??
          "Push delivery failed — check server logs for Expo ticket/receipt errors (often missing APNs key on EAS).",
      activeDeviceCount: tokens.length,
      results,
      ...status,
    },
  });
});

notificationsRouter.get("/", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { data: rawNotifications } = await supabaseAdmin
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(120);

  // Hide notifications originating from a blocked user (either direction).
  const blockedSet = new Set(await getBlockedIds(userId));
  const notifications = (rawNotifications ?? []).filter(
    (n: any) =>
      (!n.from_user_id || !blockedSet.has(n.from_user_id)) &&
      n.type !== "ping" &&
      n.type !== "message"
  );

  const fromUserIds = [...new Set((notifications ?? []).map((n: any) => n.from_user_id).filter(Boolean))];
  let profileMap: Record<string, any> = {};
  if (fromUserIds.length > 0) {
    const { data: profiles } = await supabaseAdmin.from("profiles").select("*").in("id", fromUserIds as string[]);
    for (const p of profiles ?? []) profileMap[p.id] = p;
  }

  // For friend_request notifications, fetch friendship IDs in one query.
  const friendRequestNotifs = (notifications ?? []).filter((n: any) => n.type === "friend_request");
  let friendshipMap: Record<string, string> = {};
  if (friendRequestNotifs.length > 0) {
    const requesterIds = [
      ...new Set(friendRequestNotifs.map((n: any) => n.from_user_id).filter(Boolean)),
    ] as string[];
    if (requesterIds.length > 0) {
      const { data: friendships } = await supabaseAdmin
        .from("friendships")
        .select("id, requester_id, status")
        .eq("receiver_id", userId)
        .eq("status", "pending")
        .in("requester_id", requesterIds);
      const byRequester: Record<string, string> = {};
      for (const fs of friendships ?? []) {
        byRequester[fs.requester_id] = fs.id;
      }
      for (const n of friendRequestNotifs) {
        if (n.from_user_id && byRequester[n.from_user_id]) {
          friendshipMap[n.id] = byRequester[n.from_user_id];
        }
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
            name: profileMap[n.from_user_id].full_name ?? "",
            username: profileMap[n.from_user_id].username ?? "",
            avatar: resolveAvatarUrl(
              profileMap[n.from_user_id].id,
              profileMap[n.from_user_id].avatar_url,
              profileMap[n.from_user_id].gender
            ),
          }
        : { id: "system", name: "Path+", username: "", avatar: "" },
      message: n.message,
      postId: n.post_id ?? undefined,
      friendshipId: friendshipMap[n.id] ?? undefined,
      read: n.read,
      createdAt: n.created_at,
    })),
  });
});

// Mark every unread notification for the current user as read (called when the
// notifications screen/panel is opened, clearing the bell badge).
notificationsRouter.post("/read-all", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  await supabaseAdmin
    .from("notifications")
    .update({ read: true })
    .eq("user_id", userId)
    .eq("read", false);
  return c.body(null, 204);
});

notificationsRouter.post("/:id/read", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  await supabaseAdmin
    .from("notifications")
    .update({ read: true })
    .eq("id", id)
    .eq("user_id", userId);
  return c.body(null, 204);
});

export { notificationsRouter };
