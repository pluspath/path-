import { Hono } from "hono";
import { createUserClient, supabaseAdmin } from "../supabase";
import { formatPost } from "./users";
import { sanitizeSearchQuery } from "../lib/auth-helpers";
import { getBlockedIds } from "../lib/blocks";
import { env } from "../env";
import type { HonoVariables } from "../types";

const socialRouter = new Hono<{ Variables: HonoVariables }>();

const POST_SELECT =
  "*, profiles(*), reactions(user_id, type, profiles:user_id(avatar_url))";

/** GET /api/social/trending — posts ranked by recent engagement */
socialRouter.get("/trending", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const userClient = createUserClient(token);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: posts }, { data: friendships }, blockedIds] = await Promise.all([
    userClient
      .from("posts")
      .select("*, profiles(*), reactions(user_id, type, profiles:user_id(avatar_url))")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100),
    userClient
      .from("friendships")
      .select("requester_id, receiver_id")
      .eq("status", "accepted")
      .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`),
    getBlockedIds(userId),
  ]);

  const friendIds = new Set<string>();
  for (const f of friendships ?? []) {
    friendIds.add(f.requester_id === userId ? f.receiver_id : f.requester_id);
  }
  const blockedIdsSet = new Set(blockedIds);

  const scored = (posts ?? [])
    .filter((p: any) => {
      if (blockedIdsSet.has(p.user_id)) return false;
      if (p.user_id === userId) return true;
      const visibility = p.profiles?.post_visibility === "everyone" ? "everyone" : "friends";
      if (visibility === "everyone") return true;
      return friendIds.has(p.user_id);
    })
    .map((p: any) => {
      const reactionScore = (p.reactions?.length ?? 0) * 3;
      const commentScore = (p.comment_count ?? 0) * 4;
      const ageHours = Math.max(1, (Date.now() - new Date(p.created_at).getTime()) / 36e5);
      const score = (reactionScore + commentScore + 1) / Math.pow(ageHours + 2, 1.2);
      return { post: p, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .map(({ post }) => formatPost(post));

  return c.json({ data: scored });
});

/** GET /api/social/saved — bookmarked posts */
socialRouter.get("/saved", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const userClient = createUserClient(token);
  const { data: saved, error } = await userClient
    .from("saved_posts")
    .select("post_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    if (error.message?.includes("saved_posts") || error.code === "42P01") {
      return c.json({ data: [] });
    }
    return c.json({ error: { message: "Failed to load saved posts" } }, 500);
  }

  const postIds = (saved ?? []).map((s: any) => s.post_id);
  if (postIds.length === 0) return c.json({ data: [] });

  const { data: posts } = await userClient
    .from("posts")
    .select("*, profiles(*), reactions(user_id, type, profiles:user_id(avatar_url))")
    .in("id", postIds);

  const postMap: Record<string, any> = {};
  for (const p of posts ?? []) postMap[p.id] = p;

  const ordered = postIds
    .map((id: string) => postMap[id])
    .filter(Boolean)
    .map((p: any) => ({ ...formatPost(p), isSaved: true }));

  return c.json({ data: ordered });
});

/** GET /api/social/liked-moments — moments the current user has reacted to */
socialRouter.get("/liked-moments", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const userClient = createUserClient(token);

  // Do not select/order reactions.created_at — older DBs may lack that column,
  // which made PostgREST fail and the Liked tab show nothing.
  const { data: myReactions, error: reactionsError } = await supabaseAdmin
    .from("reactions")
    .select("post_id")
    .eq("user_id", userId);

  if (reactionsError) {
    console.error("[social/liked-moments] reactions query failed:", reactionsError.message);
    return c.json({ error: { message: "Failed to load liked moments" } }, 500);
  }

  const orderedPostIds: string[] = [];
  const seen = new Set<string>();
  for (const r of myReactions ?? []) {
    const pid = (r as any).post_id as string | undefined;
    if (pid && !seen.has(pid)) {
      seen.add(pid);
      orderedPostIds.push(pid);
    }
  }
  if (orderedPostIds.length === 0) return c.json({ data: [] });

  // Same privacy boundary as the home feed: self + accepted friends, minus blocked.
  const blockedIds = await getBlockedIds(userId);
  const blockedSet = new Set(blockedIds);

  const { data: friendships } = await userClient
    .from("friendships")
    .select("requester_id, receiver_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);

  const friendIds = (friendships ?? []).map((f: any) =>
    f.requester_id === userId ? f.receiver_id : f.requester_id
  );
  const allowedUserIds = new Set(
    Array.from(new Set([userId, ...friendIds])).filter(
      (id) => id === userId || !blockedSet.has(id)
    )
  );

  const { data: posts, error: postsError } = await supabaseAdmin
    .from("posts")
    .select(POST_SELECT)
    .in("id", orderedPostIds);

  if (postsError) {
    console.error("[social/liked-moments] posts query failed:", postsError.message);
    return c.json({ error: { message: "Failed to load liked moments" } }, 500);
  }

  const visible = (posts ?? []).filter((p: any) => allowedUserIds.has(p.user_id));
  visible.sort(
    (a: any, b: any) =>
      new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
  );

  return c.json({
    data: visible.map((p: any) => formatPost(p, userId, blockedIds)),
  });
});

/** POST /api/social/posts/:id/save */
socialRouter.post("/posts/:id/save", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const postId = c.req.param("id");
  const userClient = createUserClient(token);

  const { data: post } = await userClient.from("posts").select("id").eq("id", postId).maybeSingle();
  if (!post) return c.json({ error: { message: "Post not found" } }, 404);

  // Prefer insert; treat unique conflict as already-saved success (avoids UPDATE RLS on upsert)
  const { error } = await userClient
    .from("saved_posts")
    .insert({ user_id: userId, post_id: postId });

  if (error) {
    const alreadySaved =
      error.code === "23505" ||
      error.message?.toLowerCase().includes("duplicate") ||
      error.message?.toLowerCase().includes("unique");
    if (!alreadySaved) {
      console.error("[social] save error:", error.message);
      return c.json({ error: { message: "Failed to save post" } }, 500);
    }
  }

  return c.json({ data: { saved: true } });
});

/** DELETE /api/social/posts/:id/save */
socialRouter.delete("/posts/:id/save", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const postId = c.req.param("id");
  const userClient = createUserClient(token);
  await userClient.from("saved_posts").delete().eq("user_id", userId).eq("post_id", postId);
  return c.body(null, 204);
});

/** POST /api/social/posts/:id/share */
socialRouter.post("/posts/:id/share", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const postId = c.req.param("id");
  let platform = "in_app";
  try {
    const body = await c.req.json().catch(() => ({}));
    if (typeof body?.platform === "string" && body.platform.length < 40) {
      platform = body.platform;
    }
  } catch {
    // no body
  }

  const userClient = createUserClient(token);
  const { data: post } = await userClient
    .from("posts")
    .select("id, user_id, content")
    .eq("id", postId)
    .maybeSingle();

  if (!post) return c.json({ error: { message: "Post not found" } }, 404);

  await userClient.from("post_shares").insert({
    post_id: postId,
    user_id: userId,
    platform,
  });

  const shareUrl = `${env.BACKEND_URL}/share/post/${postId}`;
  const shareText = post.content
    ? `Check out this moment on Path+: ${String(post.content).slice(0, 120)}`
    : "Check out this moment on Path+";

  return c.json({
    data: {
      shareUrl: shareUrl || `pathplus://post/${postId}`,
      shareText,
      postId,
    },
  });
});

/** GET /api/social/hashtags/trending */
socialRouter.get("/hashtags/trending", async (c) => {
  const user = c.get("user");
  const token = c.get("accessToken");
  if (!user || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const userClient = createUserClient(token);
  const { data, error } = await userClient
    .from("hashtags")
    .select("tag, post_count")
    .order("post_count", { ascending: false })
    .limit(20);

  if (error) {
    return c.json({ data: [] });
  }

  return c.json({
    data: (data ?? []).map((h: any) => ({
      tag: h.tag,
      postCount: h.post_count ?? 0,
    })),
  });
});

/** GET /api/social/hashtags/:tag — posts for a hashtag */
socialRouter.get("/hashtags/:tag", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const rawTag = c.req.param("tag").replace(/^#/, "").toLowerCase();
  const tag = sanitizeSearchQuery(rawTag, 40);
  if (tag.length < 2) return c.json({ data: [] });

  const userClient = createUserClient(token);
  const { data: hashtag } = await userClient
    .from("hashtags")
    .select("id, tag, post_count")
    .eq("tag", tag)
    .maybeSingle();

  if (!hashtag) return c.json({ data: { tag, postCount: 0, posts: [] } });

  const { data: links } = await userClient
    .from("post_hashtags")
    .select("post_id")
    .eq("hashtag_id", hashtag.id)
    .limit(40);

  const postIds = (links ?? []).map((l: any) => l.post_id);
  if (postIds.length === 0) {
    return c.json({ data: { tag: hashtag.tag, postCount: hashtag.post_count, posts: [] } });
  }

  const { data: posts } = await userClient
    .from("posts")
    .select("*, profiles(*), reactions(user_id, type, profiles:user_id(avatar_url))")
    .in("id", postIds)
    .order("created_at", { ascending: false });

  return c.json({
    data: {
      tag: hashtag.tag,
      postCount: hashtag.post_count,
      posts: (posts ?? []).map(formatPost),
    },
  });
});

/** GET /api/social/search — unified search (users + hashtags) */
socialRouter.get("/search", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const q = sanitizeSearchQuery(c.req.query("q") ?? "");
  if (q.length < 2) {
    return c.json({ data: { users: [], hashtags: [], posts: [] } });
  }

  const userClient = createUserClient(token);
  const type = c.req.query("type") ?? "all";

  let users: any[] = [];
  let hashtags: any[] = [];
  let posts: any[] = [];

  if (type === "all" || type === "users") {
    const [{ data: profiles }, { data: myFriendships }, blockedList] = await Promise.all([
      userClient
        .from("profiles")
        .select("*")
        .or(`full_name.ilike.%${q}%,username.ilike.%${q}%,bio.ilike.%${q}%`)
        .neq("id", userId)
        .limit(15),
      userClient
        .from("friendships")
        .select("id, requester_id, receiver_id, status")
        .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`),
      getBlockedIds(userId),
    ]);

    const blocked = new Set(blockedList);
    const friendshipByUser: Record<string, { id: string; status: string; isSender: boolean }> = {};
    for (const f of myFriendships ?? []) {
      const otherId = f.requester_id === userId ? f.receiver_id : f.requester_id;
      friendshipByUser[otherId] = { id: f.id, status: f.status, isSender: f.requester_id === userId };
    }

    users = (profiles ?? [])
      .filter((p: any) => !blocked.has(p.id))
      .map((p: any) => {
        const fs = friendshipByUser[p.id];
        let friendshipStatus: string = "none";
        let friendshipId: string | undefined;
        if (fs) {
          friendshipId = fs.id;
          if (fs.status === "accepted") friendshipStatus = "friends";
          else if (fs.status === "pending") {
            friendshipStatus = fs.isSender ? "pending_sent" : "pending_received";
          } else if (fs.status === "blocked") friendshipStatus = "blocked";
        }
        return {
          id: p.id,
          name: p.full_name ?? "",
          username: p.username ?? "",
          avatar: p.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.id}`,
          bio: p.bio ?? "",
          friendshipStatus,
          friendshipId,
        };
      });
  }

  if (type === "all" || type === "hashtags") {
    const { data: tags } = await userClient
      .from("hashtags")
      .select("tag, post_count")
      .ilike("tag", `%${q}%`)
      .order("post_count", { ascending: false })
      .limit(10);
    hashtags = (tags ?? []).map((h: any) => ({ tag: h.tag, postCount: h.post_count ?? 0 }));
  }

  if (type === "all" || type === "posts") {
    const { data: found } = await userClient
      .from("posts")
      .select("*, profiles(*), reactions(user_id, type, profiles:user_id(avatar_url))")
      .ilike("content", `%${q}%`)
      .order("created_at", { ascending: false })
      .limit(15);
    posts = (found ?? []).map(formatPost);
  }

  return c.json({ data: { users, hashtags, posts, query: q } });
});

export { socialRouter };
