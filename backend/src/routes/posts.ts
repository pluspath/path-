import { Hono } from "hono";
import { createUserClient, supabaseAdmin } from "../supabase";
import { formatPost, formatReactions, isReactionLocked, baseReactionType, lockedReactionType } from "./users";
import { sendPushNotification, getPushToken } from "../lib/push";
import { SYSTEM_MOMENT_TYPES, refreshFriendshipAvatars } from "../lib/systemMoments";
import { ensureBirthdayMoments } from "../lib/birthday";
import { notifyMentions } from "../lib/mentions";
import { encodeImages } from "../lib/images";
import { getBlockedIds } from "../lib/blocks";
import { parseDurationToMinutes } from "../lib/duration";
import type { HonoVariables } from "../types";

const postsRouter = new Hono<{ Variables: HonoVariables }>();

// Standard post select: the row + author profile + reactions (with reactor
// avatars). `*` returns whatever columns exist, so `repath_of` is included
// automatically once the column is added and simply absent before then.
const POST_SELECT = "*, profiles(*), reactions(user_id, type, profiles:user_id(avatar_url))";

// The set of authors who have privately starred `viewerId` as a close friend.
// Read with the admin client because RLS restricts `close_friends` rows to their
// owner. Used to deliver audience='close' moments only to the author's starred
// close friends. Returns an empty set if the table isn't set up yet (graceful).
async function getWhoStarredMe(viewerId: string): Promise<Set<string>> {
  try {
    // Support both schema variants: user_id (common) and owner_id (older).
    let { data, error } = await supabaseAdmin
      .from("close_friends")
      .select("user_id")
      .eq("friend_id", viewerId);

    if (error || !data) {
      ({ data, error } = await supabaseAdmin
        .from("close_friends")
        .select("owner_id")
        .eq("friend_id", viewerId));
      if (error || !data) return new Set();
      return new Set(data.map((r: any) => r.owner_id).filter(Boolean));
    }
    return new Set(data.map((r: any) => r.user_id).filter(Boolean));
  } catch {
    return new Set();
  }
}

// Attach the nested `original` moment to any repath posts. Uses the RLS-scoped
// userClient so feed privacy is preserved — originals the viewer isn't allowed
// to see come back as null. No-ops when nothing references an original (e.g.
// before the `repath_of` column exists), so it's safe with or without the SQL.
async function attachOriginals(userClient: any, posts: any[]) {
  const originalIds = Array.from(
    new Set((posts ?? []).map((p) => p?.repath_of).filter(Boolean))
  );
  if (originalIds.length === 0) return posts;
  const { data: originals } = await userClient
    .from("posts")
    .select(POST_SELECT)
    .in("id", originalIds);
  const byId = new Map((originals ?? []).map((o: any) => [o.id, o]));
  for (const p of posts) {
    if (p?.repath_of) p.original = byId.get(p.repath_of) ?? null;
  }
  return posts;
}

postsRouter.get("/", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const userClient = createUserClient(token);

  // Privacy: the home timeline shows ONLY the current user's own moments plus
  // moments from ACCEPTED (mutual) friends. Pending/requested relationships
  // must never expose any moments — for every moment type, including the
  // "Joined Path+" auto-moments.
  const { data: acceptedFriendships } = await userClient
    .from("friendships")
    .select("requester_id, receiver_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);

  const friendIds = (acceptedFriendships ?? []).map((f: any) =>
    f.requester_id === userId ? f.receiver_id : f.requester_id
  );

  // Self + accepted friends. (Always include self even with no friends yet.)
  // Then remove anyone blocked in either direction (self is never blocked).
  const blockedIds = await getBlockedIds(userId!);
  const blockedSet = new Set(blockedIds);
  const allowedUserIds = Array.from(new Set([userId, ...friendIds])).filter(
    (id) => id === userId || !blockedSet.has(id as string)
  );

  // Lazily detect birthdays (the viewer's + their friends') and create the
  // birthday moment + friend notifications before loading the feed, so a fresh
  // birthday moment shows up in this same response. Idempotent (once per year).
  await ensureBirthdayMoments(userId!, friendIds);

  const { data: posts } = await userClient
    .from("posts")
    .select(POST_SELECT)
    .in("user_id", allowedUserIds)
    .order("created_at", { ascending: false })
    .limit(50);

  // Per-post audience enforcement. `whoStarredMe` = the set of authors who have
  // privately starred ME as a close friend (read with the admin client because
  // RLS hides other users' close_friends rows). A post with audience='close' is
  // delivered only to the author's starred close friends; 'private' is author-
  // only; everything else (incl. a missing `audience` column) behaves as today.
  const whoStarredMe = await getWhoStarredMe(userId!);
  const visible = (posts ?? []).filter((p: any) => {
    if (p.user_id === userId) return true; // my own moments always show
    const audience = p.audience ?? "friends";
    if (audience === "private") return false;
    if (audience === "close") return whoStarredMe.has(p.user_id);
    return true; // 'public' | 'friends' | unknown
  });

  await attachOriginals(userClient, visible);
  const formatted = visible.map((p) => formatPost(p, userId ?? undefined, blockedIds));
  await refreshFriendshipAvatars(formatted); // always show friends' CURRENT avatars
  return c.json({ data: formatted });
});

// Matches #hashtag tokens: latin + accented + Arabic letters, digits, underscore.
// Mirrors the client-side TOKEN_RE in mobile/src/components/RichText.tsx so the
// backend extracts exactly the tokens the app renders as blue hashtags.
const HASHTAG_RE = /#([A-Za-z0-9_À-ɏ؀-ۿ]+)/g;

function extractHashtags(content: string | null | undefined): string[] {
  if (!content) return [];
  const out: string[] = [];
  let m: RegExpExecArray | null;
  HASHTAG_RE.lastIndex = 0;
  while ((m = HASHTAG_RE.exec(content)) !== null) {
    if (m[1]) out.push(m[1].toLowerCase());
  }
  return out;
}

// Compute the viewer's allowed authors: themselves + accepted (mutual) friends.
// This is the SAME privacy boundary the home feed uses.
async function getAllowedAuthorIds(userClient: any, userId: string): Promise<string[]> {
  const { data: acceptedFriendships } = await userClient
    .from("friendships")
    .select("requester_id, receiver_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);
  const friendIds = (acceptedFriendships ?? []).map((f: any) =>
    f.requester_id === userId ? f.receiver_id : f.requester_id
  );
  return Array.from(new Set([userId, ...friendIds]));
}

// GET /api/posts/hashtags?q=prefix — autocomplete from EXISTING hashtags used
// in the app. Simple prefix match (no semantic/related suggestions). Returns up
// to 10 distinct hashtags (without the leading #), most-used first.
postsRouter.get("/hashtags", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const prefix = (c.req.query("q") ?? "").replace(/^#+/, "").trim().toLowerCase();

  // Pull recent posts that actually contain a hashtag and tally distinct tags.
  const { data: rows } = await supabaseAdmin
    .from("posts")
    .select("content")
    .ilike("content", "%#%")
    .order("created_at", { ascending: false })
    .limit(1000);

  const counts = new Map<string, number>();
  for (const r of rows ?? []) {
    for (const tag of extractHashtags((r as any).content)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  const suggestions = Array.from(counts.entries())
    .filter(([tag]) => (prefix ? tag.startsWith(prefix) : true))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([tag]) => tag);

  return c.json({ data: suggestions });
});

// GET /api/posts/hashtag/:tag — all moments containing :tag, filtered by the
// SAME privacy rules as the home feed (viewer's own + accepted friends'
// moments). Newest first. Never exposes a moment the viewer couldn't see in
// their normal feed.
postsRouter.get("/hashtag/:tag", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const normalized = (c.req.param("tag") ?? "").replace(/^#+/, "").trim().toLowerCase();
  if (!normalized) return c.json({ data: [] });

  const userClient = createUserClient(token);
  const blockedIds = await getBlockedIds(userId);
  const blockedSet = new Set(blockedIds);
  const allowedUserIds = (await getAllowedAuthorIds(userClient, userId)).filter(
    (id) => id === userId || !blockedSet.has(id)
  );

  // Candidate fetch: same privacy boundary + a cheap content prefilter. The
  // exact token match happens in JS so "#foo" never matches "#foobar".
  const { data: posts } = await userClient
    .from("posts")
    .select(POST_SELECT)
    .in("user_id", allowedUserIds)
    .ilike("content", `%#${normalized}%`)
    .order("created_at", { ascending: false })
    .limit(200);

  const matching = (posts ?? []).filter((p: any) =>
    extractHashtags(p.content).includes(normalized)
  );
  await attachOriginals(userClient, matching);

  return c.json({ data: matching.map((p) => formatPost(p, userId ?? undefined, blockedIds)) });
});

// GET /api/posts/reacted — moments the CURRENT user has reacted to (any
// reaction they themselves gave). Respects the SAME privacy boundary as the
// home feed: only moments the viewer can still access (their own + accepted
// friends'). Declared before "/:id" so it isn't captured as an id.
//
// IMPORTANT: do NOT order/select reactions.created_at — older DBs never had
// that column, and PostgREST then returns an error (silent empty Liked tab).
postsRouter.get("/reacted", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const userClient = createUserClient(token);

  const { data: myReactions, error: reactionsError } = await supabaseAdmin
    .from("reactions")
    .select("post_id")
    .eq("user_id", userId);

  if (reactionsError) {
    console.error("[posts/reacted] reactions query failed:", reactionsError.message);
    return c.json({ error: { message: "Failed to load liked moments" } }, 500);
  }

  // Distinct post ids (stable order — reaction table has no reliable timestamp
  // on older schemas; we sort by post.created_at below).
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

  // Same privacy boundary as the feed (self + accepted friends), minus blocked.
  const blockedIds = await getBlockedIds(userId);
  const blockedSet = new Set(blockedIds);
  const allowedUserIds = new Set(
    (await getAllowedAuthorIds(userClient, userId)).filter(
      (id) => id === userId || !blockedSet.has(id)
    )
  );

  // Fetch by id via service role so a missing/partial posts RLS policy can't
  // silently drop liked moments; privacy is enforced in JS below.
  const { data: posts, error: postsError } = await supabaseAdmin
    .from("posts")
    .select(POST_SELECT)
    .in("id", orderedPostIds);

  if (postsError) {
    console.error("[posts/reacted] posts query failed:", postsError.message);
    return c.json({ error: { message: "Failed to load liked moments" } }, 500);
  }

  const visible = (posts ?? []).filter((p: any) => allowedUserIds.has(p.user_id));
  await attachOriginals(userClient, visible);

  // Newest moments first (post time — reliable across schemas).
  visible.sort(
    (a: any, b: any) =>
      new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
  );

  return c.json({ data: visible.map((p: any) => formatPost(p, userId, blockedIds)) });
});

postsRouter.get("/:id", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const userClient = createUserClient(token);
  const { data: post } = await userClient
    .from("posts")
    .select(POST_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (!post) return c.json({ error: { message: "Post not found" } }, 404);

  await attachOriginals(userClient, [post]);

  // Hide moments authored by a blocked user (either direction) entirely.
  const blockedIds = userId ? await getBlockedIds(userId) : [];
  if (post.user_id !== userId && blockedIds.includes(post.user_id)) {
    return c.json({ error: { message: "Post not found" } }, 404);
  }

  return c.json({ data: formatPost(post, userId ?? undefined, blockedIds) });
});

postsRouter.post("/", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = await c.req.json();
  const userClient = createUserClient(token);

  const insertData: Record<string, any> = {
    user_id: userId,
    type: body.type,
    content: body.content || null,
    // Accept either a single `image` (legacy) or an `images` array (up to 6).
    image_url: encodeImages(body.images, body.image),
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
    // sleep_duration is an INTEGER (minutes) column; the client sends "8h 30m".
    // Parse to minutes here so the Awake moment actually inserts.
    sleep_duration: parseDurationToMinutes(body.sleepDuration),
  };
  // Reshare ("Repath"): only set `repath_of` when this is actually a repath, so
  // normal posting is never affected if the column hasn't been added yet.
  if (body.repathOf) insertData.repath_of = body.repathOf;
  // Audience ("Close Friends" etc.): only set when the client explicitly sends a
  // non-default value, so normal posting still works if the column doesn't exist
  // yet. 'close' delivers only to the author's starred close friends (enforced in
  // the feed query below); 'private' is author-only; 'public'/'friends' behave as
  // today (visible to all accepted friends).
  if (body.audience && body.audience !== "friends") insertData.audience = body.audience;
  // Disable Comments: only set when explicitly true (default false = omit, which
  // matches the column default). Lets the insert succeed if the column is absent.
  if (body.commentsDisabled === true) insertData.comments_disabled = true;

  let { data: post, error } = await userClient
    .from("posts")
    .insert(insertData)
    .select(POST_SELECT)
    .single();

  // If an optional column (audience / comments_disabled) hasn't been added yet,
  // don't fail the post — strip the optional fields and retry so the moment
  // still publishes (audience behaves as "friends", comments stay enabled).
  if (
    error &&
    ("audience" in insertData || "comments_disabled" in insertData) &&
    /audience|comments_disabled|column/i.test(error.message ?? "")
  ) {
    const { audience: _a, comments_disabled: _cd, ...withoutOptional } = insertData;
    ({ data: post, error } = await userClient
      .from("posts")
      .insert(withoutOptional)
      .select(POST_SELECT)
      .single());
  }

  if (error) {
    console.error("Create post error:", error);
    // Repath attempted before the `repath_of` column exists → tell the client
    // clearly instead of a generic failure, and never create a junk post.
    if (body.repathOf && /repath_of|column/i.test(error.message ?? "")) {
      return c.json({ error: { message: "Repath isn't set up yet. Run the one-line SQL to enable it." } }, 400);
    }
    return c.json({ error: { message: "Failed to create post" } }, 500);
  }

  // Resolve the nested original so the new repath renders immediately.
  if (post?.repath_of) await attachOriginals(userClient, [post]);

  if (body.sleepAction === "sleep") {
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
      await userClient.from("notifications").insert(notifications);
    }
  }

  // Notify anyone @mentioned in the moment's text.
  await notifyMentions({
    authorId: userId,
    authorName: user.full_name,
    content: post.content,
    postId: post.id,
  });

  return c.json({ data: formatPost(post, userId) }, 201);
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
    .select("id, user_id, type")
    .eq("id", id)
    .maybeSingle();

  if (!existingPost) return c.json({ error: { message: "Post not found" } }, 404);
  if (existingPost.user_id !== userId) return c.json({ error: { message: "Forbidden" } }, 403);
  if (SYSTEM_MOMENT_TYPES.includes(existingPost.type)) return c.json({ error: { message: "This moment cannot be edited" } }, 403);

  const body = await c.req.json();
  const updateData: Record<string, unknown> = {};
  if ("content" in body) updateData.content = body.content || null;
  if ("image" in body || "images" in body) updateData.image_url = encodeImages(body.images, body.image);
  // Location (check-in): allow adding, changing, or clearing (null) on edit.
  if ("locationName" in body) updateData.location = body.locationName || null;
  if ("locationLat" in body) updateData.location_lat = body.locationLat ?? null;
  if ("locationLng" in body) updateData.location_lng = body.locationLng ?? null;
  // Audience: same delivery-scope values as create. Default missing/empty to
  // "friends" so we never write null into the column.
  if ("audience" in body) updateData.audience = body.audience || "friends";
  // Disable Comments: persist the boolean when the client sends it.
  if ("commentsDisabled" in body) updateData.comments_disabled = !!body.commentsDisabled;

  const SELECT = "*, profiles(*), reactions(user_id, type, profiles:user_id(avatar_url))";
  let { data: updated, error } = await userClient
    .from("posts")
    .update(updateData)
    .eq("id", id)
    .select(SELECT)
    .single();

  // Degrade safely if an optional column (audience / comments_disabled) hasn't
  // been added yet — retry without it so the rest of the edit (caption, photos,
  // location) still saves.
  if (
    error &&
    ("audience" in updateData || "comments_disabled" in updateData) &&
    /audience|comments_disabled|column/i.test(error.message ?? "")
  ) {
    const { audience: _a, comments_disabled: _cd, ...withoutOptional } = updateData;
    ({ data: updated, error } = await userClient
      .from("posts")
      .update(withoutOptional)
      .eq("id", id)
      .select(SELECT)
      .single());
  }

  if (error) {
    console.error("Update post error:", error);
    return c.json({ error: { message: "Failed to update post" } }, 500);
  }

  return c.json({ data: formatPost(updated, userId) });
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
    .select("id, user_id, type")
    .eq("id", id)
    .maybeSingle();

  if (!post) return c.json({ error: { message: "Post not found" } }, 404);
  if (post.user_id !== userId) return c.json({ error: { message: "Forbidden" } }, 403);
  if (SYSTEM_MOMENT_TYPES.includes(post.type)) return c.json({ error: { message: "This moment cannot be deleted" } }, 403);

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
  // The client always sends a plain emoji; normalize defensively.
  const incoming = baseReactionType(type);

  // Use admin client to bypass RLS and safely handle any existing duplicates.
  // Avoid ordering by created_at — that column is missing on older schemas.
  const { data: existing } = await supabaseAdmin
    .from("reactions")
    .select("id, type")
    .eq("post_id", id)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  // Track whether this call actually ADDED a reaction (vs toggled one off), so
  // we only notify the owner on a genuine new reaction.
  let didReact = false;
  if (existing) {
    // Delete ALL reactions for this user+post (cleans up any historical duplicates too)
    await supabaseAdmin.from("reactions").delete().eq("post_id", id).eq("user_id", userId);
    if (baseReactionType(existing.type) !== incoming) {
      // Different emoji → switch to the new one (a fresh reaction is public/unlocked)
      await supabaseAdmin.from("reactions").insert({ post_id: id, user_id: userId, type: incoming });
      didReact = true;
    }
    // Same emoji → already deleted above (toggle off; any lock is cleared with it)
  } else {
    await supabaseAdmin.from("reactions").insert({ post_id: id, user_id: userId, type: incoming });
    didReact = true;
  }

  // Notify the post owner (activity feed + push), never about their own action,
  // and only when a reaction was actually added. The sheep (🐑) sent from a
  // sleep moment reads as "sent you a sheep"; any other emoji reads as a love.
  try {
    const { data: postOwner } = await userClient.from("posts").select("user_id").eq("id", id).maybeSingle();
    if (didReact && postOwner && postOwner.user_id !== userId) {
      const isSheep = incoming === "🐑";
      await supabaseAdmin.from("notifications").insert({
        user_id: postOwner.user_id,
        from_user_id: userId,
        type: isSheep ? "sleep" : "reaction",
        message: isSheep ? "sent you a sheep" : "loved your moment",
        post_id: id,
        read: false,
      });

      const pushToken = await getPushToken(supabaseAdmin, postOwner.user_id);
      await sendPushNotification(
        pushToken,
        isSheep ? "New Sheep" : "New Reaction",
        isSheep ? `${user.full_name} sent you a sheep` : `${user.full_name} reacted to your moment`,
        { postId: id, type: isSheep ? "sleep" : "reaction" }
      );
    }
  } catch (e) {
    console.error("[notifications] reaction insert error:", e);
  }

  const { data: ownerRow } = await supabaseAdmin.from("posts").select("user_id").eq("id", id).maybeSingle();
  const { data: reactions } = await supabaseAdmin.from("reactions").select("user_id, type, profiles:user_id(avatar_url)").eq("post_id", id);
  // Viewer here is the reactor — they always see their own reaction.
  return c.json({ data: { reactions: formatReactions(reactions ?? [], userId, ownerRow?.user_id) } });
});

// Toggle the privacy lock on the current user's reaction for a post.
// Locked = visible only to the reactor and the moment owner. Independent of
// the emoji itself (locking never removes the reaction).
postsRouter.post("/:id/reactions/lock", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();

  const { data: existing } = await supabaseAdmin
    .from("reactions")
    .select("id, type")
    .eq("post_id", id)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existing) return c.json({ error: { message: "No reaction to lock" } }, 400);

  const nextLocked = !isReactionLocked(existing.type);
  const newType = nextLocked ? lockedReactionType(existing.type) : baseReactionType(existing.type);
  await supabaseAdmin.from("reactions").update({ type: newType }).eq("post_id", id).eq("user_id", userId);

  const { data: ownerRow } = await supabaseAdmin.from("posts").select("user_id").eq("id", id).maybeSingle();
  const { data: reactions } = await supabaseAdmin.from("reactions").select("user_id, type, profiles:user_id(avatar_url)").eq("post_id", id);
  return c.json({ data: { locked: nextLocked, reactions: formatReactions(reactions ?? [], userId, ownerRow?.user_id) } });
});

// Record that the current viewer has SEEN this moment (read receipt).
// Called by the client when a moment becomes actually visible on screen.
// The unique(post_id, user_id) constraint makes repeat views a no-op, and the
// owner viewing their OWN moment is never recorded.
postsRouter.post("/:id/view", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();

  const { data: ownerRow } = await supabaseAdmin.from("posts").select("user_id").eq("id", id).maybeSingle();
  if (!ownerRow) return c.json({ error: { message: "Post not found" } }, 404);
  // The author seeing their own moment is not a "view".
  if (ownerRow.user_id === userId) return c.body(null, 204);

  // Upsert; ignoreDuplicates means each viewer is recorded at most once.
  await supabaseAdmin
    .from("post_views")
    .upsert(
      { post_id: id, user_id: userId, viewed_at: new Date().toISOString() },
      { onConflict: "post_id,user_id", ignoreDuplicates: true }
    );

  return c.body(null, 204);
});

// Read receipts for a moment — OWNER ONLY. Returns the real "Seen by X of Y"
// data: X = distinct accepted friends who viewed it, Y = total accepted friends
// (the audience), and the viewers (friends who actually viewed) for the grid.
postsRouter.get("/:id/views", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();

  const { data: ownerRow } = await supabaseAdmin.from("posts").select("user_id").eq("id", id).maybeSingle();
  if (!ownerRow) return c.json({ error: { message: "Post not found" } }, 404);
  if (ownerRow.user_id !== userId) return c.json({ error: { message: "Forbidden" } }, 403);

  // The audience = the owner's accepted (mutual) friends.
  const { data: acceptedFriendships } = await supabaseAdmin
    .from("friendships")
    .select("requester_id, receiver_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);

  const friendIds = (acceptedFriendships ?? []).map((f: any) =>
    f.requester_id === userId ? f.receiver_id : f.requester_id
  );
  const friendTotal = friendIds.length;

  if (friendIds.length === 0) {
    return c.json({ data: { seenCount: 0, friendTotal: 0, viewers: [] } });
  }

  // Distinct accepted friends who viewed this moment (most recent first).
  const { data: views } = await supabaseAdmin
    .from("post_views")
    .select("user_id, viewed_at")
    .eq("post_id", id)
    .in("user_id", friendIds)
    .order("viewed_at", { ascending: false });

  const viewerIds = (views ?? []).map((v: any) => v.user_id);
  let profilesById: Record<string, any> = {};
  if (viewerIds.length > 0) {
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", viewerIds);
    profilesById = Object.fromEntries((profs ?? []).map((p: any) => [p.id, p]));
  }

  const viewers = (views ?? []).map((v: any) => ({
    userId: v.user_id,
    userName: profilesById[v.user_id]?.full_name ?? "",
    userAvatar:
      profilesById[v.user_id]?.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${v.user_id}`,
  }));

  return c.json({ data: { seenCount: viewers.length, friendTotal, viewers } });
});

postsRouter.get("/:id/comments", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
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

  // Hide comments authored by a blocked user (either direction).
  const blockedSet = userId ? new Set(await getBlockedIds(userId)) : null;

  const formatted = (comments ?? [])
    .filter((comment: any) => !blockedSet || !blockedSet.has(comment.user_id))
    .map((comment: any) => ({
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
  const userClient = createUserClient(token);

  // Block commenting when the moment's author turned comments off. `select("*")`
  // is safe even before the `comments_disabled` column exists (it's just absent,
  // so the guard is a no-op until the column is added — degrade-safe).
  const { data: targetPost } = await userClient
    .from("posts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (targetPost?.comments_disabled) {
    return c.json({ error: { message: "Comments are turned off for this moment" } }, 403);
  }

  const { data: comment, error } = await supabaseAdmin
    .from("comments")
    .insert({ id: crypto.randomUUID(), post_id: id, user_id: userId, content: body.content })
    .select("id, post_id, user_id, content, created_at")
    .single();

  if (error || !comment) {
    console.error("Create comment error:", error);
    return c.json({ error: { message: "Failed to create comment" } }, 500);
  }

  const { data: postData } = await userClient
    .from("posts")
    .select("comment_count")
    .eq("id", id)
    .single();

  if (postData) {
    await userClient
      .from("posts")
      .update({ comment_count: (postData.comment_count ?? 0) + 1 })
      .eq("id", id);
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, avatar_url")
    .eq("id", userId)
    .single();

  // Notify the post owner (activity feed + push), never about their own comment.
  try {
    const { data: postOwner } = await userClient.from("posts").select("user_id").eq("id", id).maybeSingle();
    if (postOwner && postOwner.user_id !== userId) {
      await supabaseAdmin.from("notifications").insert({
        user_id: postOwner.user_id,
        from_user_id: userId,
        type: "comment",
        message: "commented on your moment",
        post_id: id,
        read: false,
      });

      const pushToken = await getPushToken(supabaseAdmin, postOwner.user_id);
      await sendPushNotification(
        pushToken,
        "New Comment",
        `${user.full_name} commented on your moment`,
        { postId: id, type: "comment" }
      );
    }
  } catch (e) {
    console.error("[notifications] comment insert error:", e);
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

  // Notify anyone @mentioned in the comment text. post_id points at the moment
  // so tapping the notification opens the moment showing this comment.
  await notifyMentions({
    authorId: userId,
    authorName: user.full_name,
    content: comment.content,
    postId: id,
  });

  return c.json({ data: formatted }, 201);
});

postsRouter.delete("/:id/comments/:commentId", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id, commentId } = c.req.param();
  const userClient = createUserClient(token);

  const { data: comment, error: fetchError } = await supabaseAdmin
    .from("comments")
    .select("id, post_id, user_id")
    .eq("id", commentId)
    .maybeSingle();

  if (fetchError || !comment || comment.post_id !== id) {
    return c.json({ error: { message: "Comment not found" } }, 404);
  }

  // Delete permission: the comment's author OR the moment's owner.
  const { data: postOwner } = await supabaseAdmin
    .from("posts")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  const isCommentAuthor = comment.user_id === userId;
  const isMomentOwner = postOwner?.user_id === userId;
  if (!isCommentAuthor && !isMomentOwner) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const { error: deleteError } = await supabaseAdmin
    .from("comments")
    .delete()
    .eq("id", commentId);

  if (deleteError) {
    console.error("Delete comment error:", deleteError);
    return c.json({ error: { message: "Failed to delete comment" } }, 500);
  }

  const { data: postData } = await userClient
    .from("posts")
    .select("comment_count")
    .eq("id", id)
    .single();

  if (postData) {
    await userClient
      .from("posts")
      .update({ comment_count: Math.max((postData.comment_count ?? 1) - 1, 0) })
      .eq("id", id);
  }

  return c.json({ data: null });
});

postsRouter.patch("/:id/comments/:commentId", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id, commentId } = c.req.param();
  const body = await c.req.json();
  const content = (body?.content ?? "").toString().trim();
  if (!content) return c.json({ error: { message: "Comment cannot be empty" } }, 400);

  const { data: comment, error: fetchError } = await supabaseAdmin
    .from("comments")
    .select("id, post_id, user_id")
    .eq("id", commentId)
    .maybeSingle();

  if (fetchError || !comment || comment.post_id !== id) {
    return c.json({ error: { message: "Comment not found" } }, 404);
  }

  // Edit permission: ONLY the comment's author may edit (not the moment owner).
  if (comment.user_id !== userId) return c.json({ error: { message: "Forbidden" } }, 403);

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("comments")
    .update({ content })
    .eq("id", commentId)
    .select("id, post_id, user_id, content, created_at, profiles:user_id(id, full_name, avatar_url)")
    .single();

  if (updateError || !updated) {
    console.error("Update comment error:", updateError);
    return c.json({ error: { message: "Failed to update comment" } }, 500);
  }

  const u: any = updated;
  const formatted = {
    id: u.id,
    postId: u.post_id,
    userId: u.user_id,
    content: u.content,
    createdAt: u.created_at,
    user: {
      id: u.user_id,
      name: u.profiles?.full_name ?? "",
      avatar: u.profiles?.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.user_id}`,
    },
  };

  return c.json({ data: formatted });
});

export { postsRouter };
