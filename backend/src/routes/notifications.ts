import { Hono } from "hono";
import { supabaseAdmin } from "../supabase";
import { getBlockedIds } from "../lib/blocks";
import {
  getPushTokensForUser,
  getPushStatusForUser,
  sendPushNotificationDetailed,
  getUnreadNotificationBadgeCount,
  getBadgeBreakdown,
  countUnreadNotificationsForUser,
} from "../lib/push";
import { defaultAvatarForGender, resolveAvatarUrl } from "../lib/avatar";
import { parseLimit, parseCursor, encodeCursor } from "../lib/pagination";
import { decodeImages } from "../lib/images";
import { momentTextPreview } from "../lib/moment-preview";
import type { HonoVariables } from "../types";

const notificationsRouter = new Hono<{ Variables: HonoVariables }>();

/** Older rows sometimes stored the actor or moment id under a second column name. */
function actorIdOf(n: Record<string, unknown>): string | null {
  const id = n.from_user_id || n.actor_id || n.sender_id;
  return id ? String(id) : null;
}

function postIdOf(n: Record<string, unknown>): string | null {
  const id = n.post_id || n.postId;
  return id ? String(id) : null;
}

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
      (!actorIdOf(n) || !blockedSet.has(actorIdOf(n) as string)) &&
      n.type !== "ping" &&
      n.type !== "message"
  );

  // Drop stale LIKE notices whose reaction was removed (and delete them).
  // Do NOT apply this to "sleep" status alerts ("X is sleeping") — only to
  // sheep-reaction notices, which share type "sleep" but say "sent you a sheep".
  const reactionLikeNotifs = notifications.filter((n: any) => {
    if (!postIdOf(n) || !actorIdOf(n)) return false;
    if (n.type === "reaction") return true;
    if (n.type === "sleep") {
      const msg = String(n.message ?? "").toLowerCase();
      return msg.includes("sheep") || msg.includes("liked");
    }
    return false;
  });
  if (reactionLikeNotifs.length > 0) {
    const postIds = [...new Set(reactionLikeNotifs.map((n: any) => postIdOf(n)!))];
    const actorIds = [...new Set(reactionLikeNotifs.map((n: any) => actorIdOf(n)!))];
    const { data: liveReactions } = await supabaseAdmin
      .from("reactions")
      .select("post_id, user_id")
      .in("post_id", postIds)
      .in("user_id", actorIds);
    const liveKeys = new Set(
      (liveReactions ?? []).map((r: any) => `${r.post_id}:${r.user_id}`)
    );
    const orphanIds: string[] = [];
    const isReactionNotice = (n: any) => {
      if (n.type === "reaction") return true;
      if (n.type === "sleep") {
        const msg = String(n.message ?? "").toLowerCase();
        return msg.includes("sheep") || msg.includes("liked");
      }
      return false;
    };
    notifications = notifications.filter((n: any) => {
      if (!isReactionNotice(n)) return true;
      const pid = postIdOf(n);
      const aid = actorIdOf(n);
      if (!pid || !aid) return true;
      const alive = liveKeys.has(`${pid}:${aid}`);
      if (!alive) orphanIds.push(String(n.id));
      return alive;
    });
    if (orphanIds.length > 0) {
      void supabaseAdmin.from("notifications").delete().in("id", orphanIds);
    }
  }

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

  const fromUserIds = [...new Set(page.map((n: any) => actorIdOf(n)).filter(Boolean))];
  let profileMap: Record<string, any> = {};
  if (fromUserIds.length > 0) {
    const { data: profiles } = await supabaseAdmin.from("profiles").select("*").in("id", fromUserIds as string[]);
    for (const p of profiles ?? []) profileMap[p.id] = p;
  }

  // Attach Moment preview: media thumb when the Moment has image/video,
  // otherwise the Moment's text caption (never junk JSON / UUIDs).
  const postIds = [
    ...new Set(page.map((n: any) => postIdOf(n)).filter(Boolean)),
  ] as string[];
  const postImageMap: Record<string, string> = {};
  const postSnippetMap: Record<string, string> = {};
  const postHasMedia = new Set<string>();
  if (postIds.length > 0) {
    const { data: posts } = await supabaseAdmin
      .from("posts")
      .select("id, image_url, content, type")
      .in("id", postIds);
    for (const p of posts ?? []) {
      const imgs = decodeImages((p as any).image_url);
      if (imgs[0]) {
        postImageMap[p.id] = imgs[0];
        postHasMedia.add(p.id);
      }
      const snippet = momentTextPreview((p as any).content, { maxLen: 100 });
      if (snippet) postSnippetMap[p.id] = snippet;
    }
  }

  const interactionTypes = new Set([
    "reaction",
    "comment",
    "mention",
    "repath",
    "sleep",
  ]);

  // For friend_request notifications, fetch friendship IDs in one query.
  const friendRequestNotifs = page.filter((n: any) => n.type === "friend_request");
  let friendshipMap: Record<string, string> = {};
  if (friendRequestNotifs.length > 0) {
    const requesterIds = [
      ...new Set(friendRequestNotifs.map((n: any) => actorIdOf(n)).filter(Boolean)),
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
        const requesterId = actorIdOf(n);
        const fid = requesterId ? byRequester[requesterId] : undefined;
        if (fid) friendshipMap[n.id] = fid;
      }
    }
  }

  return c.json({
    data: page.map((n: any) => {
      const actorId = actorIdOf(n);
      const profile = actorId ? profileMap[actorId] : undefined;
      const momentId = postIdOf(n);
      return {
      id: n.id,
      type: n.type,
      user: profile
        ? {
            id: profile.id,
            name: profile.full_name ?? "",
            username: profile.username ?? "",
            avatar: resolveAvatarUrl(profile.id, profile.avatar_url, profile.gender),
            bio: profile.bio ?? "",
            location: profile.location ?? "",
            gender: profile.gender ?? undefined,
          }
        : actorId
          ? {
              id: actorId,
              name: "",
              username: "",
              avatar: defaultAvatarForGender(actorId),
              bio: "",
              location: "",
            }
          : { id: "system", name: "Path+", username: "", avatar: "" },
      message: n.message,
      postId: momentId ?? undefined,
      // Media Moments → thumbnail. Text Moments → caption. Never both when media exists.
      postImage: (momentId && postImageMap[momentId]) || n.post_image || undefined,
      postSnippet:
        momentId &&
        interactionTypes.has(String(n.type)) &&
        !postHasMedia.has(momentId)
          ? postSnippetMap[momentId]
          : undefined,
      friendshipId: friendshipMap[n.id] ?? undefined,
      read: n.read,
      createdAt: n.created_at,
      };
    }),
    nextCursor,
    hasMore,
    limit,
    // Exact unread total for the bell (never derive from this page alone).
    unreadTotal: await countUnreadNotificationsForUser(supabaseAdmin, userId),
  });
});

/** Exact badge totals for the OS icon + in-app indicators.
 * `total` / `appIcon` = unread bell notifications + unread message threads.
 */
notificationsRouter.get("/badge", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const breakdown = await getBadgeBreakdown(supabaseAdmin, userId);
  const appIcon = breakdown.total; // notifications + messages (capped 99 for OS)
  return c.json({
    data: {
      notifications: breakdown.notifications,
      messages: breakdown.messages,
      total: appIcon,
      appIcon,
      unreadNotifications: breakdown.notifications,
      unreadMessages: breakdown.messages,
    },
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
