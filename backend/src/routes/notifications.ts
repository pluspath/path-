import { Hono } from "hono";
import { supabaseAdmin } from "../supabase";
import { getBlockedIds } from "../lib/blocks";
import {
  getPushTokensForUser,
  getPushStatusForUser,
  sendPushNotificationDetailed,
  getUnreadNotificationBadgeCount,
  getBadgeBreakdown,
} from "../lib/push";
import { resolveAvatarUrl } from "../lib/avatar";
import { parseLimit, parseCursor, encodeCursor } from "../lib/pagination";
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
    tokens.map(async (token) => {
      const badge = await getUnreadNotificationBadgeCount(supabaseAdmin, userId);
      return sendPushNotificationDetailed(
        token,
        "Path+ Test Notification",
        "Push Notifications are working correctly.",
        { type: "test" },
        supabaseAdmin,
        { waitForReceipt: true, badge, userId }
      );
    })
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

  const limit = parseLimit(c.req.query("limit"), 20, 50);
  const cursor = parseCursor(c.req.query("cursor"));
  // Over-fetch a bit — ping/message + blocked filters drop rows after the query.
  const fetchLimit = Math.min(limit * 3 + 10, 150);

  let notifQuery = supabaseAdmin
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);
  if (cursor?.createdAt) {
    notifQuery = notifQuery.lt("created_at", cursor.createdAt);
  }

  const { data: rawNotifications } = await notifQuery;

  // Hide notifications originating from a blocked user (either direction).
  const blockedSet = new Set(await getBlockedIds(userId));
  let notifications = (rawNotifications ?? []).filter(
    (n: any) =>
      (!n.from_user_id || !blockedSet.has(n.from_user_id)) &&
      n.type !== "ping" &&
      n.type !== "message"
  );

  // Id tiebreak when cursor includes `|id`.
  if (cursor?.id) {
    notifications = notifications.filter((n: any) => {
      const t = new Date(n.created_at).getTime();
      const ct = new Date(cursor.createdAt).getTime();
      if (t < ct) return true;
      if (t > ct) return false;
      return String(n.id) < cursor.id!;
    });
  }

  const hasMore = notifications.length > limit;
  const page = hasMore ? notifications.slice(0, limit) : notifications;
  const last = page.length > 0 ? page[page.length - 1] : null;
  const nextCursor =
    hasMore && last?.created_at
      ? encodeCursor(String(last.created_at), String(last.id ?? ""))
      : null;

  const fromUserIds = [...new Set(page.map((n: any) => n.from_user_id).filter(Boolean))];
  let profileMap: Record<string, any> = {};
  if (fromUserIds.length > 0) {
    const { data: profiles } = await supabaseAdmin.from("profiles").select("*").in("id", fromUserIds as string[]);
    for (const p of profiles ?? []) profileMap[p.id] = p;
  }

  // For friend_request notifications, fetch friendship IDs in one query.
  const friendRequestNotifs = page.filter((n: any) => n.type === "friend_request");
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
        const fid = n.from_user_id ? byRequester[n.from_user_id] : undefined;
        if (fid) friendshipMap[n.id] = fid;
      }
    }
  }

  return c.json({
    data: page.map((n: any) => ({
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
    nextCursor,
    hasMore,
    limit,
  });
});

/** Exact badge totals for the OS icon + in-app indicators. */
notificationsRouter.get("/badge", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const breakdown = await getBadgeBreakdown(supabaseAdmin, userId);
  return c.json({ data: breakdown });
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
