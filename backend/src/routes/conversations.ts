import { Hono } from "hono";
import { supabaseAdmin } from "../supabase";
import { sendPushToUser } from "../lib/push";
import { encodeImages, decodeImages } from "../lib/images";
import { getBlockedIds, isBlocked } from "../lib/blocks";
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

// Normalize a DB message row into the API message shape.
// Location messages store their data as JSON in `content` (no dedicated columns),
// so unpack them into locationName/locationLat/locationLng here.
function mapMessage(m: any, replyPreview?: { id: string; text: string; type?: string; senderId?: string } | null) {
  const base = {
    id: m.id,
    senderId: m.sender_id,
    type: m.type ?? "text",
    createdAt: m.created_at,
    replyToId: m.reply_to ?? undefined,
    replyTo: replyPreview ?? undefined,
  };
  if (m.type === "location") {
    try {
      const loc = JSON.parse(m.content ?? m.text ?? "{}");
      return {
        ...base,
        text: loc.name ?? "Shared a location",
        locationName: loc.name ?? "",
        locationLat: typeof loc.lat === "number" ? loc.lat : undefined,
        locationLng: typeof loc.lng === "number" ? loc.lng : undefined,
      };
    } catch {
      return { ...base, text: m.content ?? m.text ?? "" };
    }
  }
  if (m.type === "audio" || m.type === "music") {
    let meta: { title?: string; duration?: number } = {};
    try {
      meta = JSON.parse(m.content ?? m.text ?? "{}");
    } catch {
      meta = { title: m.content ?? m.text ?? undefined };
    }
    const audioUrl = decodeImages(m.image_url ?? m.image)[0] ?? m.image_url ?? undefined;
    return {
      ...base,
      text: meta.title ?? (m.type === "music" ? "Music" : "Voice message"),
      audioUrl,
      audioTitle: meta.title,
      audioDuration: typeof meta.duration === "number" ? meta.duration : undefined,
    };
  }
  // image_url may hold a single URL (legacy) or a JSON array (multi-image).
  // Also fall back to legacy `image` column.
  const images = decodeImages(m.image_url ?? m.image);
  return {
    ...base,
    // Prefer content; fall back to legacy `text` column for older rows.
    text: m.content ?? m.text ?? "",
    image: images[0] ?? undefined,
    images: images.length > 0 ? images : undefined,
  };
}

function previewFromMessageRow(m: any): string {
  if (!m) return "";
  if (m.type === "image") return "📷 Photo";
  if (m.type === "location") {
    try {
      const loc = JSON.parse(m.content ?? m.text ?? "{}");
      return loc.name ?? "📍 Location";
    } catch {
      return "📍 Location";
    }
  }
  if (m.type === "audio") return "🎤 Voice message";
  if (m.type === "music") return "🎵 Music";
  if (m.type === "ping") return "👋 Ping";
  return m.content ?? m.text ?? "";
}

async function attachReplyPreviews(db: any, mapped: any[], rows: any[]) {
  const replyIds = [...new Set(rows.map((r) => r.reply_to).filter(Boolean))];
  if (replyIds.length === 0) return mapped;
  const { data: parents } = await db.from("messages").select("*").in("id", replyIds);
  const byId: Record<string, any> = {};
  for (const p of parents ?? []) byId[p.id] = p;
  return mapped.map((msg, i) => {
    const parentId = rows[i]?.reply_to;
    if (!parentId || !byId[parentId]) return msg;
    const p = byId[parentId];
    return {
      ...msg,
      replyToId: parentId,
      replyTo: {
        id: p.id,
        text: previewFromMessageRow(p),
        type: p.type ?? "text",
        senderId: p.sender_id,
      },
    };
  });
}

// Short human label for a message, used in push notifications + last-message previews.
function messagePreview(type: string, text: string | null | undefined): string {
  if (type === "image") return "📷 Photo";
  if (type === "location") return "📍 Shared a location";
  if (type === "ping") return "👋 Pinged you";
  if (type === "audio") return "🎤 Voice message";
  if (type === "music") return "🎵 Music";
  return text ?? "Sent you a message";
}

// Fire-and-forget push to all OTHER participants of a conversation.
// Intentionally NOT awaited by request handlers: the message is already saved,
// so we respond to the client immediately and let exp.host delivery happen in
// the background. Errors are swallowed (logged) so they can't crash anything.
function notifyParticipantsInBackground(
  db: any,
  conversationId: string,
  senderId: string,
  senderName: string,
  body: string,
  data: Record<string, any>
) {
  (async () => {
    try {
      const { data: otherParticipants } = await db
        .from("conversation_participants")
        .select("user_id")
        .eq("conversation_id", conversationId)
        .neq("user_id", senderId);

      await Promise.all(
        (otherParticipants ?? []).map(async (participant: any) => {
          // DM alerts (message/ping) live on the Messages tab via unread counts — not the bell.
          const isDm = data?.type === "ping" || data?.type === "message";
          if (!isDm) {
            await db.from("notifications").insert({
              user_id: participant.user_id,
              from_user_id: senderId,
              type: data?.type ?? "message",
              message: body,
              read: false,
            });
          }

          const pushTitle =
            data?.type === "message" ? `New message from ${senderName}` : senderName;
          await sendPushToUser(db, participant.user_id, pushTitle, body, data);
        })
      );
    } catch (e) {
      console.error("[push] background notification error:", e);
    }
  })();
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
  // Auth is JWT-derived userId (set only after supabase.auth.getUser succeeds).
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  // Always use service role for the inbox so RLS on participants/messages cannot
  // return an empty list for a valid participant.
  const db = supabaseAdmin;

  try {
    const { data: participations, error: partErr } = await db
      .from("conversation_participants")
      .select("conversation_id, last_read_at")
      .eq("user_id", userId);

    if (partErr) {
      console.error("[conversations] list participations error:", partErr.message);
      return c.json({ error: { message: "Failed to load conversations" } }, 500);
    }

    const convIds = (participations ?? []).map((p: any) => p.conversation_id);
    if (convIds.length === 0) return c.json({ data: [] });

    const lastReadByConv: Record<string, string | null> = {};
    for (const p of participations ?? []) lastReadByConv[p.conversation_id] = p.last_read_at ?? null;

    const [{ data: conversations }, { data: allParticipants }, blockedIds] = await Promise.all([
      db.from("conversations").select("*").in("id", convIds).order("updated_at", { ascending: false }),
      db
        .from("conversation_participants")
        .select("conversation_id, user_id")
        .in("conversation_id", convIds)
        .neq("user_id", userId),
      getBlockedIds(userId, db),
    ]);

    const otherUserIdByConv: Record<string, string> = {};
    for (const p of allParticipants ?? []) {
      if (!otherUserIdByConv[p.conversation_id]) otherUserIdByConv[p.conversation_id] = p.user_id;
    }

    const blockedSet = new Set(blockedIds);
    const visibleConversations = (conversations ?? []).filter((conv: any) => {
      const otherUserId = otherUserIdByConv[conv.id];
      return !otherUserId || !blockedSet.has(otherUserId);
    });
    const visibleIds = visibleConversations.map((c: any) => c.id);
    if (visibleIds.length === 0) return c.json({ data: [] });

    const otherUserIds = [
      ...new Set(visibleIds.map((id: string) => otherUserIdByConv[id]).filter(Boolean)),
    ];

    // Prefer selecting only widely-present columns (avoid failing the whole inbox
    // when a legacy `text` column is missing or renamed).
    let recentMsgs: any[] | null = null;
    {
      const primary = await db
        .from("messages")
        .select("id, conversation_id, content, created_at, sender_id, type")
        .in("conversation_id", visibleIds)
        .order("created_at", { ascending: false })
        .limit(Math.min(visibleIds.length * 40, 800));
      if (primary.error) {
        console.warn("[conversations] messages select fallback:", primary.error.message);
        const fallback = await db
          .from("messages")
          .select("*")
          .in("conversation_id", visibleIds)
          .order("created_at", { ascending: false })
          .limit(Math.min(visibleIds.length * 40, 800));
        recentMsgs = fallback.data;
      } else {
        recentMsgs = primary.data;
      }
    }

    const { data: profiles } =
      otherUserIds.length > 0
        ? await db.from("profiles").select("*").in("id", otherUserIds)
        : { data: [] as any[] };

    const profilesById: Record<string, any> = {};
    for (const p of profiles ?? []) profilesById[p.id] = formatProfile(p);

    const lastMsgByConv: Record<string, any> = {};
    const unreadByConv: Record<string, number> = {};
    for (const id of visibleIds) unreadByConv[id] = 0;

    for (const m of recentMsgs ?? []) {
      if (!lastMsgByConv[m.conversation_id]) lastMsgByConv[m.conversation_id] = m;
    }

    // Exact unread counts from last_read_at (same logic as /unread-counts).
    await Promise.all(
      visibleIds.map(async (convId) => {
        const lastRead = lastReadByConv[convId];
        let query = db
          .from("messages")
          .select("*", { count: "exact", head: true })
          .eq("conversation_id", convId)
          .neq("sender_id", userId);
        if (lastRead) query = query.gt("created_at", lastRead);
        const { count } = await query;
        unreadByConv[convId] = count ?? 0;
      })
    );

    const result = visibleConversations.map((conv: any) => {
      const otherUserId = otherUserIdByConv[conv.id];
      const lastMsg = lastMsgByConv[conv.id];
      const previewText = lastMsg?.content ?? lastMsg?.text ?? "";
      return {
        id: conv.id,
        user: (otherUserId && profilesById[otherUserId]) || emptyUser(otherUserId),
        lastMessage: lastMsg ? messagePreview(lastMsg.type, previewText) : "",
        lastMessageTime: lastMsg?.created_at ?? conv.created_at,
        lastMessageSenderId: lastMsg?.sender_id ?? null,
        unreadCount: unreadByConv[conv.id] ?? 0,
        messages: [],
      };
    });

    result.sort(
      (a, b) => new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
    );

    return c.json({ data: result });
  } catch (err) {
    console.error("[conversations] list unexpected:", err);
    return c.json({ error: { message: "Failed to load conversations" } }, 500);
  }
});

conversationsRouter.get("/:id", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  // Always use service role for chat reads so both participants can open the
  // same conversation even when RLS on participants is incomplete.
  const db = supabaseAdmin;

  const { id } = c.req.param();

  // Security: caller must be a participant (based on JWT userId, not a profile row).
  const { data: participation } = await db
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!participation) return c.json({ error: { message: "Not found" } }, 404);

  const { data: conv } = await db.from("conversations").select("*").eq("id", id).single();
  if (!conv) return c.json({ error: { message: "Not found" } }, 404);

  // Other participant(s): grab their last_read_at so the client can render
  // read receipts ("Read" under a sent message once they've read past it).
  const { data: participants } = await db
    .from("conversation_participants")
    .select("user_id, last_read_at")
    .eq("conversation_id", id)
    .neq("user_id", userId);

  const otherUserId = participants?.[0]?.user_id;
  // For 1:1 this is the single other person; designed so group chats can later
  // take the MIN across all others ("Read by ALL").
  const otherLastReadAt =
    (participants ?? []).reduce<string | null>((min, p: any) => {
      const v = p.last_read_at ?? null;
      if (v === null) return null; // someone hasn't read => not "read by all"
      if (min === undefined) return v;
      return min === null ? null : v < min ? v : min;
    }, undefined as any) ?? null;

  let otherUser = null;
  if (otherUserId) {
    const { data: profile } = await db.from("profiles").select("*").eq("id", otherUserId).single();
    otherUser = profile ? formatProfile(profile) : null;
  }

  const { data: msgs } = await db
    .from("messages")
    .select("*")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  const last = msgs?.[msgs.length - 1];
  const mapped = await attachReplyPreviews(db, (msgs ?? []).map((m: any) => mapMessage(m)), msgs ?? []);

  return c.json({
    data: {
      id: conv.id,
      user: otherUser ?? emptyUser(),
      lastMessage: last ? messagePreview(last.type, last.content) : "",
      lastMessageTime: conv.updated_at,
      unreadCount: 0,
      otherLastReadAt,
      messages: mapped,
    },
  });
});

// Per-conversation unread counts, computed server-side from
// conversation_participants.last_read_at (consistent across devices).
conversationsRouter.post("/unread-counts", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const db = supabaseAdmin;

  const { data: participations } = await db
    .from("conversation_participants")
    .select("conversation_id, last_read_at")
    .eq("user_id", userId);

  const result: Record<string, number> = {};

  await Promise.all(
    (participations ?? []).map(async (p: any) => {
      let query = db
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("conversation_id", p.conversation_id)
        .neq("sender_id", userId);
      // No last_read_at yet => all messages from others are unread.
      if (p.last_read_at) query = query.gt("created_at", p.last_read_at);

      const { count } = await query;
      result[p.conversation_id] = count ?? 0;
    })
  );

  return c.json({ data: result });
});

// Mark a conversation as read for the current user: set last_read_at = now().
// Server-side so the read state is consistent across all the user's devices.
conversationsRouter.post("/:id/read", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const db = supabaseAdmin;

  const { id } = c.req.param();

  const { error } = await db
    .from("conversation_participants")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", id)
    .eq("user_id", userId);

  if (error) return c.json({ error: { message: "Failed to mark read" } }, 500);

  return c.json({ data: { ok: true } });
});

conversationsRouter.post("/:id/messages", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const db = supabaseAdmin;

  const { id } = c.req.param();
  const {
    text,
    image,
    images,
    type = "text",
    locationName,
    locationLat,
    locationLng,
    audioUrl,
    audioTitle,
    audioDuration,
    replyToId,
  } = await c.req.json();

  // Security check: verify user is a participant
  const { data: participation } = await db
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!participation) return c.json({ error: { message: "Unauthorized" } }, 403);

  // Block: refuse to send if any other participant is blocked (either direction).
  const { data: others } = await db
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", id)
    .neq("user_id", userId);
  const blockedSet = new Set(await getBlockedIds(userId, db));
  if ((others ?? []).some((p: any) => blockedSet.has(p.user_id))) {
    return c.json({ error: { message: "Unable to message this user" } }, 403);
  }

  // Accept a single `image` (legacy) or an `images` array (up to 6).
  const hasImages = !!(images?.length || image);
  const hasAudio = !!(audioUrl && (type === "audio" || type === "music"));
  const msgType =
    type === "location"
      ? "location"
      : type === "ping"
        ? "ping"
        : hasAudio
          ? type
          : hasImages
            ? "image"
            : type ?? "text";

  // Location / audio / music messages encode metadata in `content`.
  // DB has NOT NULL on `text` — never insert null for any message type.
  let content: string;
  if (msgType === "location") {
    content = JSON.stringify({ name: locationName ?? "", lat: locationLat ?? null, lng: locationLng ?? null });
  } else if (msgType === "audio" || msgType === "music") {
    content = JSON.stringify({
      title: audioTitle ?? text ?? (msgType === "music" ? "Music" : "Voice message"),
      duration: typeof audioDuration === "number" ? audioDuration : null,
    });
  } else if (msgType === "image") {
    content = (typeof text === "string" && text.length > 0 ? text : "📷");
  } else {
    content = typeof text === "string" ? text : "";
  }
  // Empty string is allowed; null is not (Postgres NOT NULL on messages.text).
  if (!content && msgType !== "text") {
    content =
      msgType === "image"
        ? "📷"
        : msgType === "audio"
          ? "🎤"
          : msgType === "music"
            ? "🎵"
            : msgType === "location"
              ? "📍"
              : msgType === "ping"
                ? "👋"
                : "";
  }

  const imageUrl =
    msgType === "location" ? null : hasAudio ? audioUrl : encodeImages(images, image);

  if (msgType === "image" && !imageUrl) {
    return c.json({ error: { message: "Image URL required" } }, 400);
  }
  if ((msgType === "audio" || msgType === "music") && !audioUrl) {
    return c.json({ error: { message: "Audio URL required" } }, 400);
  }

  let replyTo: string | null = null;
  if (typeof replyToId === "string" && replyToId.length > 0) {
    const { data: parent } = await db
      .from("messages")
      .select("id, conversation_id")
      .eq("id", replyToId)
      .eq("conversation_id", id)
      .maybeSingle();
    if (parent?.id) replyTo = parent.id;
  }

  const rowFull: Record<string, any> = {
    conversation_id: id,
    sender_id: userId,
    content,
    text: content,
    image_url: imageUrl,
    image: imageUrl,
    type: msgType,
  };
  if (replyTo) rowFull.reply_to = replyTo;

  let message: any = null;
  let error: any = null;
  ({ data: message, error } = await db.from("messages").insert(rowFull).select().single());

  // Fall back when legacy columns are missing (or reply_to isn't migrated yet).
  // Always keep `text` non-null — never omit it in any fallback.
  if (error && /column|content|text|image|reply/i.test(error.message ?? "")) {
    const withoutReply = { ...rowFull };
    delete withoutReply.reply_to;
    ({ data: message, error } = await db.from("messages").insert(withoutReply).select().single());
  }
  if (error && /column|content|image|reply/i.test(error.message ?? "")) {
    ({ data: message, error } = await db
      .from("messages")
      .insert({
        conversation_id: id,
        sender_id: userId,
        content,
        text: content,
        image_url: imageUrl,
        type: msgType,
        ...(replyTo ? { reply_to: replyTo } : {}),
      })
      .select()
      .single());
  }
  if (error && /column|content|image|reply/i.test(error.message ?? "")) {
    ({ data: message, error } = await db
      .from("messages")
      .insert({
        conversation_id: id,
        sender_id: userId,
        text: content,
        image: imageUrl,
        type: msgType,
      })
      .select()
      .single());
  }
  if (error && /column|image/i.test(error.message ?? "")) {
    ({ data: message, error } = await db
      .from("messages")
      .insert({
        conversation_id: id,
        sender_id: userId,
        text: content,
        type: msgType,
      })
      .select()
      .single());
  }

  if (error || !message) {
    console.error("[conversations] send message error:", error?.message);
    return c.json({ error: { message: "Failed to send message" } }, 500);
  }

  await db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id);

  // Fire-and-forget push: respond to the client immediately, deliver in background.
  const senderName = (user as any).full_name ?? "Someone";
  notifyParticipantsInBackground(db, id, userId, senderName, messagePreview(msgType, text), {
    type: "message",
    conversationId: id,
    fromUserId: userId,
  });

  let mapped = mapMessage(message);
  if (replyTo) {
    const [withReply] = await attachReplyPreviews(db, [mapped], [message]);
    mapped = withReply;
  }

  return c.json({ data: mapped }, 201);
});

// Delete a message. Only the original sender may delete their own message.
conversationsRouter.delete("/:id/messages/:messageId", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const db = supabaseAdmin;
  const { id, messageId } = c.req.param();

  const { data: participation } = await db
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!participation) return c.json({ error: { message: "Unauthorized" } }, 403);

  const { data: msg } = await db
    .from("messages")
    .select("id, sender_id, conversation_id")
    .eq("id", messageId)
    .eq("conversation_id", id)
    .maybeSingle();

  if (!msg) return c.json({ error: { message: "Not found" } }, 404);
  if (msg.sender_id !== userId) {
    return c.json({ error: { message: "You can only delete your own messages" } }, 403);
  }

  const { error } = await db.from("messages").delete().eq("id", messageId).eq("conversation_id", id);
  if (error) {
    console.error("[conversations] delete message error:", error.message);
    return c.json({ error: { message: "Failed to delete message" } }, 500);
  }

  return c.json({ data: { ok: true } });
});

conversationsRouter.post("/start/:userId", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  // Force service-role for conversation creation so BOTH participant rows are
  // always written (user JWT + RLS often only allows inserting yourself).
  const db = supabaseAdmin;

  const targetId = c.req.param("userId");
  console.log(`[conversations/start] userId=${userId} targetId=${targetId}`);

  if (!targetId || targetId === userId) {
    return c.json({ error: { message: "Cannot start a conversation with yourself" } }, 400);
  }

  // No messaging across a block (either direction).
  if (await isBlocked(userId, targetId, db)) {
    return c.json({ error: { message: "Unable to message this user" } }, 403);
  }

  // Check for existing 1-on-1 conversation between these two users
  const { data: myParticipations } = await db
    .from("conversation_participants")
    .select("conversation_id")
    .eq("user_id", userId);

  const myConvIds = (myParticipations ?? []).map((p: any) => p.conversation_id);
  console.log(`[conversations/start] myConvIds count=${myConvIds.length}`);

  let existingConvId: string | null = null;
  if (myConvIds.length > 0) {
    const { data: sharedConv } = await db
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
    // Repair: ensure BOTH participants are present (fixes "only recipient can open").
    const { data: parts } = await db
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", existingConvId);
    const present = new Set((parts ?? []).map((p: any) => p.user_id));
    if (!present.has(userId)) {
      await db.from("conversation_participants").insert({ conversation_id: existingConvId, user_id: userId });
    }
    if (!present.has(targetId)) {
      await db.from("conversation_participants").insert({ conversation_id: existingConvId, user_id: targetId });
    }

    const { data: conv } = await db.from("conversations").select("*").eq("id", existingConvId).single();
    const { data: targetProfile } = await db.from("profiles").select("*").eq("id", targetId).single();
    const { data: msgs } = await db
      .from("messages")
      .select("content, text, created_at")
      .eq("conversation_id", existingConvId)
      .order("created_at", { ascending: false })
      .limit(1);
    return c.json({
      data: {
        id: existingConvId,
        user: targetProfile ? formatProfile(targetProfile) : emptyUser(targetId),
        lastMessage: msgs?.[0]?.content ?? msgs?.[0]?.text ?? "",
        lastMessageTime: conv?.updated_at ?? new Date().toISOString(),
        unreadCount: 0,
        messages: [],
      },
    });
  }

  // Create the conversation. `db` is the service-role client when
  // SUPABASE_SERVICE_ROLE_KEY is configured, otherwise the caller's own JWT —
  // the anon key has no auth.uid() at all, so RLS rejects every insert.
  const { data: newConv, error } = await db
    .from("conversations")
    .insert({ updated_at: new Date().toISOString() })
    .select()
    .single();

  if (error || !newConv) {
    console.error("[conversations/start] insert error:", error);
    return c.json({ error: { message: "Failed to create conversation" } }, 500);
  }

  console.log(`[conversations/start] new conv created: ${newConv.id}`);

  // Insert the two participant rows one at a time: some RLS setups only allow a
  // user to add THEMSELVES, and a two-row batch would fail as a whole. If the
  // other person's row can't be written the conversation is unusable, so drop
  // it rather than leaving an orphan the user can never open.
  const { error: myRowError } = await db
    .from("conversation_participants")
    .insert({ conversation_id: newConv.id, user_id: userId });
  const { error: targetRowError } = await db
    .from("conversation_participants")
    .insert({ conversation_id: newConv.id, user_id: targetId });

  if (myRowError || targetRowError) {
    console.error("[conversations/start] participant insert error:", myRowError ?? targetRowError);
    await db.from("conversation_participants").delete().eq("conversation_id", newConv.id);
    await db.from("conversations").delete().eq("id", newConv.id);
    return c.json({ error: { message: "Failed to create conversation" } }, 500);
  }

  const { data: targetProfile } = await db.from("profiles").select("*").eq("id", targetId).single();

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
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const db = supabaseAdmin;

  const { id } = c.req.param();

  // Security check: verify user is a participant
  const { data: participation } = await db
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!participation) return c.json({ error: { message: "Unauthorized" } }, 403);

  const { data: message, error: pingError } = await db
    .from("messages")
    .insert({
      conversation_id: id,
      sender_id: userId,
      content: "Ping!",
      text: "Ping!",
      type: "ping",
    })
    .select()
    .single();

  if (pingError || !message) {
    console.error("[conversations] ping error:", pingError?.message);
    return c.json({ error: { message: "Failed to send ping" } }, 500);
  }

  await db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id);

  // Push the ping so the other person's phone buzzes + sounds even if the app is closed.
  // Fire-and-forget: respond immediately, deliver in background.
  const senderName = (user as any).full_name ?? "Someone";
  notifyParticipantsInBackground(db, id, userId, senderName, "👋 Pinged you", {
    type: "ping",
    conversationId: id,
    fromUserId: userId,
  });

  return c.json({ data: mapMessage(message) }, 201);
});

export { conversationsRouter };
