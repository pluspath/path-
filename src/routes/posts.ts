import { Hono } from "hono";
import { createUserClient, supabaseAdmin } from "../supabase";
import { formatPost } from "./users";
import { sendPushNotification, getPushToken } from "../lib/push";
import type { HonoVariables } from "../types";

const postsRouter = new Hono<{ Variables: HonoVariables }>();

postsRouter.get("/", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const userClient = createUserClient(token);
  const [{ data: posts }, { data: friendships }] = await Promise.all([
    userClient
      .from("posts")
      .select("*, profiles(*), reactions(user_id, type, profiles:user_id(avatar_url))")
      .order("created_at", { ascending: false })
      .limit(80),
    userClient
      .from("friendships")
      .select("requester_id, receiver_id")
      .eq("status", "accepted")
      .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`),
  ]);

  const friendIds = new Set<string>();
  for (const f of friendships ?? []) {
    friendIds.add(f.requester_id === userId ? f.receiver_id : f.requester_id);
  }

  const visible = (posts ?? []).filter((p: any) => {
    if (p.user_id === userId) return true;
    const visibility = p.profiles?.post_visibility === "everyone" ? "everyone" : "friends";
    if (visibility === "everyone") return true;
    return friendIds.has(p.user_id);
  }).slice(0, 50);

  return c.json({ data: visible.map(formatPost) });
});

postsRouter.get("/:id", async (c) => {
  const user = c.get("user");
  const token = c.get("accessToken");
  if (!user || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const userClient = createUserClient(token);
  const { data: post } = await userClient
    .from("posts")
    .select("*, profiles(*), reactions(user_id, type, profiles:user_id(avatar_url))")
    .eq("id", id)
    .maybeSingle();

  if (!post) return c.json({ error: { message: "Post not found" } }, 404);
  return c.json({ data: formatPost(post) });
});

postsRouter.post("/", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = await c.req.json();
  if (!body?.type || typeof body.type !== "string") {
    return c.json({ error: { message: "Post type is required" } }, 400);
  }

  const userClient = createUserClient(token);

  const { data: post, error } = await userClient
    .from("posts")
    .insert({
      user_id: userId,
      type: body.type,
      content: body.content || null,
      image_url: body.image || null,
      location: body.locationName || null,
      location_lat: body.locationLat || null,
      location_lng: body.locationLng || null,
      venue_category: body.venueCategory || null,
      music_title: body.musicTitle || null,
      music_artist: body.musicArtist || null,
      music_album: body.musicAlbum || null,
      music_mode: body.musicMode || null,
      activity_type: body.activityType || null,
      activity_duration: body.activityDuration || null,
      meal_name: body.mealName || null,
      sleep_action: body.sleepAction || null,
      sleep_duration: body.sleepDuration || null,
    })
    .select("*, profiles(*), reactions(user_id, type, profiles:user_id(avatar_url))")
    .single();

  if (error) {
    console.error("Create post error:", error);
    const isRls = error.code === "42501";
    return c.json({
      error: {
        message: isRls
          ? "Post create blocked by database security policy. Ensure RLS policies are applied (migrations/004_rls_policies.sql)."
          : (error.message || "Failed to create post"),
        code: error.code,
      },
    }, 500);
  }

  // Mobile sends "sleeping"; older clients may send "sleep"
  const isGoingToSleep = body.sleepAction === "sleep" || body.sleepAction === "sleeping";
  if (isGoingToSleep) {
    const { data: friends } = await userClient
      .from("friendships")
      .select("requester_id, receiver_id")
      .eq("status", "accepted")
      .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);

    if (friends && friends.length > 0) {
      const notifications = friends.map((f: any) => ({
        user_id: f.requester_id === userId ? f.receiver_id : f.requester_id,
        from_user_id: userId,
        type: "sleep",
        message: `${user.full_name} is sleeping`,
        post_id: post.id,
        read: false,
      }));
      // Service role: notify other users (their rows) without weakening posts RLS
      await supabaseAdmin.from("notifications").insert(notifications);
    }
  }

  return c.json({ data: formatPost(post) }, 201);
});

postsRouter.patch("/:id", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const userClient = createUserClient(token);

  const { data: existingPost } = await userClient
    .from("posts")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();

  if (!existingPost) return c.json({ error: { message: "Post not found" } }, 404);
  if (existingPost.user_id !== userId) return c.json({ error: { message: "Forbidden" } }, 403);

  const body = await c.req.json();
  const updateData: Record<string, unknown> = {};
  if ("content" in body) updateData.content = body.content || null;
  if ("image" in body) updateData.image_url = body.image || null;

  const { data: updated, error } = await userClient
    .from("posts")
    .update(updateData)
    .eq("id", id)
    .select("*, profiles(*), reactions(user_id, type, profiles:user_id(avatar_url))")
    .single();

  if (error) {
    console.error("Update post error:", error);
    return c.json({ error: { message: "Failed to update post" } }, 500);
  }

  return c.json({ data: formatPost(updated) });
});

postsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const userClient = createUserClient(token);

  const { data: post } = await userClient
    .from("posts")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();

  if (!post) return c.json({ error: { message: "Post not found" } }, 404);
  if (post.user_id !== userId) return c.json({ error: { message: "Forbidden" } }, 403);

  const { error } = await userClient.from("posts").delete().eq("id", id);
  if (error) {
    console.error("Delete post error:", error);
    return c.json({ error: { message: "Failed to delete post" } }, 500);
  }

  return c.json({ data: null });
});

postsRouter.post("/:id/reactions", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const { type } = await c.req.json();
  const userClient = createUserClient(token);

  // Use admin client to bypass RLS and safely handle any existing duplicates
  const { data: existing } = await supabaseAdmin
    .from("reactions")
    .select("id, type")
    .eq("post_id", id)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Delete ALL reactions for this user+post (cleans up any historical duplicates too)
    await supabaseAdmin.from("reactions").delete().eq("post_id", id).eq("user_id", userId);
    if (existing.type !== type) {
      // Different emoji → insert the new one
      await supabaseAdmin.from("reactions").insert({ post_id: id, user_id: userId, type });
    }
    // Same emoji → already deleted above (toggle off)
  } else {
    await supabaseAdmin.from("reactions").insert({ post_id: id, user_id: userId, type });
  }

  // Send push notification to post owner (not to themselves)
  try {
    const { data: postOwner } = await userClient.from("posts").select("user_id").eq("id", id).maybeSingle();
    if (postOwner && postOwner.user_id !== userId) {
      const pushToken = await getPushToken(supabaseAdmin, postOwner.user_id);
      await sendPushNotification(
        pushToken,
        "New Reaction",
        `${user.full_name} reacted to your post`,
        { postId: id, type: "reaction" }
      );
    }
  } catch (e) {
    console.error("[push] reaction notification error:", e);
  }

  const { data: reactions } = await supabaseAdmin.from("reactions").select("user_id, type, profiles:user_id(avatar_url)").eq("post_id", id);
  return c.json({ data: { reactions: (reactions ?? []).map((r: any) => ({ userId: r.user_id, type: r.type, userAvatar: r.profiles?.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${r.user_id}` })) } });
});

postsRouter.get("/:id/comments", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();

  const { data: comments, error } = await supabaseAdmin
    .from("comments")
    .select("id, post_id, user_id, content, created_at, profiles:user_id(id, full_name, avatar_url)")
    .eq("post_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Get comments error:", error);
    return c.json({ error: { message: "Failed to fetch comments" } }, 500);
  }

  const formatted = (comments ?? []).map((comment: any) => ({
    id: comment.id,
    postId: comment.post_id,
    userId: comment.user_id,
    content: comment.content,
    createdAt: comment.created_at,
    user: {
      id: comment.user_id,
      name: comment.profiles?.full_name ?? "",
      avatar: comment.profiles?.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${comment.user_id}`,
    },
  }));

  return c.json({ data: formatted });
});

postsRouter.post("/:id/comments", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const body = await c.req.json();
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) {
    return c.json({ error: { message: "Comment content is required" } }, 400);
  }

  const { data: comment, error } = await supabaseAdmin
    .from("comments")
    .insert({ id: crypto.randomUUID(), post_id: id, user_id: userId, content })
    .select("id, post_id, user_id, content, created_at")
    .single();

  if (error || !comment) {
    console.error("Create comment error:", error);
    return c.json({ error: { message: "Failed to create comment" } }, 500);
  }

  // comment_count on another user's post requires service role (RLS only allows own-row updates)
  const { data: postData } = await supabaseAdmin
    .from("posts")
    .select("comment_count, user_id")
    .eq("id", id)
    .single();

  if (postData) {
    await supabaseAdmin
      .from("posts")
      .update({ comment_count: (postData.comment_count ?? 0) + 1 })
      .eq("id", id);
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, avatar_url")
    .eq("id", userId)
    .single();

  // Send push notification to post owner (not to themselves)
  try {
    if (postData && postData.user_id !== userId) {
      const pushToken = await getPushToken(supabaseAdmin, postData.user_id);
      await sendPushNotification(
        pushToken,
        "New Comment",
        `${user.full_name} commented on your post`,
        { postId: id, type: "comment" }
      );
    }
  } catch (e) {
    console.error("[push] comment notification error:", e);
  }

  const formatted = {
    id: comment.id,
    postId: comment.post_id,
    userId: comment.user_id,
    content: comment.content,
    createdAt: comment.created_at,
    user: {
      id: userId,
      name: (profile as any)?.full_name ?? "",
      avatar: (profile as any)?.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
    },
  };

  return c.json({ data: formatted }, 201);
});

postsRouter.delete("/:id/comments/:commentId", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id, commentId } = c.req.param();

  const { data: comment, error: fetchError } = await supabaseAdmin
    .from("comments")
    .select("id, post_id, user_id")
    .eq("id", commentId)
    .maybeSingle();

  if (fetchError || !comment || comment.post_id !== id) {
    return c.json({ error: { message: "Comment not found" } }, 404);
  }
  if (comment.user_id !== userId) return c.json({ error: { message: "Forbidden" } }, 403);

  const { error: deleteError } = await supabaseAdmin
    .from("comments")
    .delete()
    .eq("id", commentId)
    .eq("user_id", userId);

  if (deleteError) {
    console.error("Delete comment error:", deleteError);
    return c.json({ error: { message: "Failed to delete comment" } }, 500);
  }

  const { data: postData } = await supabaseAdmin
    .from("posts")
    .select("comment_count")
    .eq("id", id)
    .single();

  if (postData) {
    await supabaseAdmin
      .from("posts")
      .update({ comment_count: Math.max((postData.comment_count ?? 1) - 1, 0) })
      .eq("id", id);
  }

  return c.json({ data: null });
});

export { postsRouter };
