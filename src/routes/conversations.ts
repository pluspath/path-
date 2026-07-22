import { Hono } from "hono";
import { supabaseAdmin } from "../supabase";
import { sendPushNotification, getPushToken } from "../lib/push";
import type { HonoVariables } from "../types";

const conversationsRouter = new Hono<{ Variables: HonoVariables }>();

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

const emptyUser = (id = "unknown") => ({
  id,
  name: "Unknown",
  avatar: "",
  username: "",
  bio: "",
  location: "",
  birthday: "",
  coverPhoto: "",
  joinDate: new Date().toISOString(),
  friendCount: 0,
  postCount: 0,
  momentCount: 0,
});

conversationsRouter.get("/", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { data: participations } = await supabaseAdmin
    .from("conversation_participants")
    .select("conversation_id")
    .eq("user_id", userId);

  const convIds = (participations ?? []).map((p: any) => p.conversation_id);
  if (convIds.length === 0) return c.json({ data: [] });

  const { data: conversations } = await supabaseAdmin
    .from("conversations")
    .select("*")
    .in("id", convIds)
    .order("updated_at", { ascending: false });

  const result = await Promise.all((conversations ?? []).map(async (conv: any) => {
    const { data: participants } = await supabaseAdmin
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", conv.id)
      .neq("user_id", userId);

    const otherUserId = participants?.[0]?.user_id;
    let otherUser = null;
    if (otherUserId) {
      const { data: profile } = await supabaseAdmin.from("profiles").select("*").eq("id", otherUserId).single();
      otherUser = profile ? formatProfile(profile) : null;
    }

    const { data: lastMsgs } = await supabaseAdmin
      .from("messages")
      .select("content, created_at, sender_id")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: false })
      .limit(1);

    const lastMsg = lastMsgs?.[0];
    return {
      id: conv.id,
      user: otherUser ?? emptyUser(),
      lastMessage: lastMsg?.content ?? "",
      lastMessageTime: lastMsg?.created_at ?? conv.created_at,
      lastMessageSenderId: lastMsg?.sender_id ?? null,
      unreadCount: 0,
      messages: [],
    };
  }));

  return c.json({ data: result });
});

conversationsRouter.get("/:id", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();

  // Security check: verify user is a participant (manual, bypasses RLS)
  const { data: participation } = await supabaseAdmin
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!participation) return c.json({ error: { message: "Not found" } }, 404);

  const { data: conv } = await supabaseAdmin.from("conversations").select("*").eq("id", id).single();
  if (!conv) return c.json({ error: { message: "Not found" } }, 404);

  const { data: participants } = await supabaseAdmin
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", id)
    .neq("user_id", userId);

  const otherUserId = participants?.[0]?.user_id;
  let otherUser = null;
  if (otherUserId) {
    const { data: profile } = await supabaseAdmin.from("profiles").select("*").eq("id", otherUserId).single();
    otherUser = profile ? formatProfile(profile) : null;
  }

  const { data: msgs } = await supabaseAdmin
    .from("messages")
    .select("*")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  return c.json({
    data: {
      id: conv.id,
      user: otherUser ?? emptyUser(),
      lastMessage: msgs?.[msgs.length - 1]?.content ?? "",
      lastMessageTime: conv.updated_at,
      unreadCount: 0,
      messages: (msgs ?? []).map((m: any) => ({
        id: m.id,
        senderId: m.sender_id,
        text: m.content,
        image: m.image_url ?? undefined,
        type: m.type,
        createdAt: m.created_at,
      })),
    },
  });
});

conversationsRouter.post("/unread-counts", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { readTimestamps } = await c.req.json();

  const result: Record<string, number> = {};

  await Promise.all(
    Object.entries(readTimestamps as Record<string, string>).map(async ([convId, lastReadAt]) => {
      const { count } = await supabaseAdmin
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("conversation_id", convId)
        .neq("sender_id", userId)
        .gt("created_at", lastReadAt);

      result[convId] = count ?? 0;
    })
  );

  return c.json({ data: result });
});

conversationsRouter.post("/:id/messages", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const { text, image, type = "text" } = await c.req.json();

  // Security check: verify user is a participant
  const { data: participation } = await supabaseAdmin
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!participation) return c.json({ error: { message: "Unauthorized" } }, 403);

  const { data: message, error } = await supabaseAdmin
    .from("messages")
    .insert({ conversation_id: id, sender_id: userId, content: text ?? null, image_url: image ?? null, type })
    .select()
    .single();

  if (error) return c.json({ error: { message: "Failed to send message" } }, 500);

  await supabaseAdmin.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id);

  // Send push notification to other participants
  try {
    const { data: otherParticipants } = await supabaseAdmin
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", id)
      .neq("user_id", userId);

    const senderName = (user as any).full_name ?? "Someone";
    for (const participant of otherParticipants ?? []) {
      const pushToken = await getPushToken(supabaseAdmin, participant.user_id);
      await sendPushNotification(
        pushToken,
        senderName,
        text ?? "Sent you a message",
        { type: "message", conversationId: id }
      );
    }
  } catch (e) {
    console.error("[push] DM notification error:", e);
  }

  return c.json({
    data: {
      id: message.id,
      senderId: message.sender_id,
      text: message.content,
      image: message.image_url ?? undefined,
      type: message.type,
      createdAt: message.created_at,
    },
  }, 201);
});

conversationsRouter.post("/start/:userId", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { userId: targetId } = c.req.param();
  console.log(`[conversations/start] userId=${userId} targetId=${targetId}`);

  // Check for existing 1-on-1 conversation between these two users
  const { data: myParticipations } = await supabaseAdmin
    .from("conversation_participants")
    .select("conversation_id")
    .eq("user_id", userId);

  const myConvIds = (myParticipations ?? []).map((p: any) => p.conversation_id);
  console.log(`[conversations/start] myConvIds count=${myConvIds.length}`);

  let existingConvId: string | null = null;
  if (myConvIds.length > 0) {
    const { data: sharedConv } = await supabaseAdmin
      .from("conversation_participants")
      .select("conversation_id")
      .eq("user_id", targetId)
      .in("conversation_id", myConvIds)
      .limit(1)
      .maybeSingle();
    existingConvId = sharedConv?.conversation_id ?? null;
  }

  if (existingConvId) {
    console.log(`[conversations/start] existing conv found: ${existingConvId}`);
    const { data: conv } = await supabaseAdmin.from("conversations").select("*").eq("id", existingConvId).single();
    const { data: targetProfile } = await supabaseAdmin.from("profiles").select("*").eq("id", targetId).single();
    const { data: msgs } = await supabaseAdmin
      .from("messages")
      .select("content, created_at")
      .eq("conversation_id", existingConvId)
      .order("created_at", { ascending: false })
      .limit(1);
    return c.json({
      data: {
        id: existingConvId,
        user: targetProfile ? formatProfile(targetProfile) : emptyUser(targetId),
        lastMessage: msgs?.[0]?.content ?? "",
        lastMessageTime: conv?.updated_at ?? new Date().toISOString(),
        unreadCount: 0,
        messages: [],
      },
    });
  }

  // Create new conversation using admin client to bypass RLS
  const { data: newConv, error } = await supabaseAdmin
    .from("conversations")
    .insert({ updated_at: new Date().toISOString() })
    .select()
    .single();

  if (error || !newConv) {
    console.error("[conversations/start] insert error:", error);
    return c.json({ error: { message: "Failed to create conversation" } }, 500);
  }

  console.log(`[conversations/start] new conv created: ${newConv.id}`);

  const { error: participantError } = await supabaseAdmin.from("conversation_participants").insert([
    { conversation_id: newConv.id, user_id: userId },
    { conversation_id: newConv.id, user_id: targetId },
  ]);

  if (participantError) {
    console.error("[conversations/start] participant insert error:", participantError);
  }

  const { data: targetProfile } = await supabaseAdmin.from("profiles").select("*").eq("id", targetId).single();

  return c.json({
    data: {
      id: newConv.id,
      user: targetProfile ? formatProfile(targetProfile) : emptyUser(targetId),
      lastMessage: "",
      lastMessageTime: newConv.created_at,
      unreadCount: 0,
      messages: [],
    },
  }, 201);
});

conversationsRouter.post("/:id/ping", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();

  // Security check: verify user is a participant
  const { data: participation } = await supabaseAdmin
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!participation) return c.json({ error: { message: "Unauthorized" } }, 403);

  const { data: message } = await supabaseAdmin
    .from("messages")
    .insert({ conversation_id: id, sender_id: userId, content: "Ping!", type: "ping" })
    .select()
    .single();

  await supabaseAdmin.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id);

  return c.json({ data: { id: message?.id, senderId: userId, text: "Ping!", type: "ping", createdAt: message?.created_at } }, 201);
});

export { conversationsRouter };
