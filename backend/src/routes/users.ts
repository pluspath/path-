import { Hono } from "hono";
import { supabase, createUserClient } from "../supabase";
import type { HonoVariables, Profile } from "../types";

const usersRouter = new Hono<{ Variables: HonoVariables }>();

function formatProfile(p: any, postCount = 0, friendCount = 0) {
  return {
    id: p.id,
    name: p.full_name ?? "",
    username: p.username ?? "",
    email: "",
    avatar: p.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.id}`,
    bio: p.bio ?? "",
    location: p.location ?? "",
    birthday: p.birthday ?? "",
    coverPhoto: p.cover_url ?? "https://images.unsplash.com/photo-1519638399535-1b036603ac77?w=800",
    joinDate: p.created_at ?? new Date().toISOString(),
    friendCount,
    postCount,
    momentCount: postCount,
    showZodiac: p.show_zodiac ?? false,
    usernameChanged: p.username_changed ?? false,
  };
}

export function formatPost(p: any) {
  return {
    id: p.id,
    userId: p.user_id,
    user: p.profiles ? formatProfile(p.profiles) : null,
    type: p.type,
    content: p.content ?? undefined,
    image: p.image_url ?? undefined,
    locationName: p.location ?? undefined,
    venueCategory: p.venue_category ?? undefined,
    musicTitle: p.music_title ?? undefined,
    musicArtist: p.music_artist ?? undefined,
    musicAlbum: p.music_album ?? undefined,
    musicMode: p.music_mode ?? undefined,
    activityType: p.activity_type ?? undefined,
    activityDuration: p.activity_duration ?? undefined,
    mealName: p.meal_name ?? undefined,
    sleepAction: p.sleep_action ?? undefined,
    sleepDuration: p.sleep_duration ?? undefined,
    reactions: (p.reactions ?? []).map((r: any) => ({ userId: r.user_id, type: r.type, userAvatar: r.profiles?.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${r.user_id}` })),
    commentCount: p.comment_count ?? 0,
    createdAt: p.created_at,
  };
}

// GET /api/search?q=...
usersRouter.get("/search", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const q = c.req.query("q") ?? "";
  if (q.length < 2) return c.json({ data: [] });

  const userClient = createUserClient(token);
  const { data: profiles } = await userClient
    .from("profiles")
    .select("*")
    .or(`full_name.ilike.%${q}%,username.ilike.%${q}%`)
    .limit(20);

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

  const results = (profiles ?? []).map((p: any) => {
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
    userClient.from("friendships").select("id", { count: "exact", head: true }).eq("status", "accepted").or(`requester_id.eq.${userId},receiver_id.eq.${userId}`),
  ]);

  return c.json({ data: formatProfile(user, postsResult.count ?? 0, friendsResult.count ?? 0) });
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
  if (body.birthday !== undefined) updateData.birthday = body.birthday;
  if (body.coverPhoto !== undefined) updateData.cover_url = body.coverPhoto;
  if (body.avatar !== undefined) updateData.avatar_url = body.avatar;
  if (body.push_token !== undefined) updateData.push_token = body.push_token;

  const { data: updated, error } = await userClient
    .from("profiles")
    .update(updateData)
    .eq("id", userId)
    .select()
    .single();

  if (error) return c.json({ error: { message: "Update failed" } }, 500);

  const [postsResult, friendsResult] = await Promise.all([
    userClient.from("posts").select("id", { count: "exact", head: true }).eq("user_id", userId),
    userClient.from("friendships").select("id", { count: "exact", head: true }).eq("status", "accepted").or(`requester_id.eq.${userId},receiver_id.eq.${userId}`),
  ]);

  return c.json({ data: formatProfile(updated, postsResult.count ?? 0, friendsResult.count ?? 0) });
});

// GET /api/:id
usersRouter.get("/:id", async (c) => {
  const user = c.get("user");
  const token = c.get("accessToken");
  if (!user || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const userClient = createUserClient(token);
  const { data: targetProfile } = await userClient.from("profiles").select("*").eq("id", id).single();
  if (!targetProfile) return c.json({ error: { message: "User not found" } }, 404);

  const [postsResult, friendsResult] = await Promise.all([
    userClient.from("posts").select("id", { count: "exact", head: true }).eq("user_id", id),
    userClient.from("friendships").select("id", { count: "exact", head: true }).eq("status", "accepted").or(`requester_id.eq.${id},receiver_id.eq.${id}`),
  ]);

  return c.json({ data: formatProfile(targetProfile, postsResult.count ?? 0, friendsResult.count ?? 0) });
});

// GET /api/:id/posts
usersRouter.get("/:id/posts", async (c) => {
  const user = c.get("user");
  const token = c.get("accessToken");
  if (!user || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const userClient = createUserClient(token);
  const { data: posts } = await userClient
    .from("posts")
    .select("*, profiles(*), reactions(user_id, type, profiles:user_id(avatar_url))")
    .eq("user_id", id)
    .order("created_at", { ascending: false });

  return c.json({ data: (posts ?? []).map(formatPost) });
});

export { usersRouter };
