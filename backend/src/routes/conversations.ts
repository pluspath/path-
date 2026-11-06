import { Hono } from "hono";
import { supabaseAdmin } from "../supabase";
import { sendPushToUser } from "../lib/push";
import { encodeImages, decodeImages } from "../lib/images";
import { getBlockedIds, isBlocked } from "../lib/blocks";
import { resolveAvatarUrl } from "../lib/avatar";
import { ensureInboxColumns } from "../lib/inbox-columns";
import {
  isMessageRequestFor,
  loadConversationsWithIncoming,
  loadFriendshipStates,
  loadPeerByConversation,
} from "../lib/message-requests";
import {
  claimPairConversation,
  getPairConversationId,
  setPairConversationId,
} from "../lib/direct-pairs";
import type { HonoVariables } from "../types";

const conversationsRouter = new Hono<{ Variables: HonoVariables }>();

/**
 * Unread DM counts via exact COUNT queries (never undercounts from row caps).
 */
async function computeUnreadCounts(
  db: any,
  userId: string,
  participations: { conversation_id: string; last_read_at?: string | null }[]
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const p of participations) {
    result[p.conversation_id] = 0;
  }
  if (participations.length === 0) return result;

  const chunkSize = 25;
  for (let i = 0; i < participations.length; i += chunkSize) {
    const chunk = participations.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (p) => {
        let q = db
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", p.conversation_id)
          .neq("sender_id", userId);
        if (p.last_read_at) q = q.gt("created_at", p.last_read_at);
        const { count, error } = await q;
        if (error) {
          console.warn("[conversations] unread count failed:", error.message);
          return;
        }
        result[p.conversation_id] = count ?? 0;
      })
    );
  }
  return result;
}

function formatProfile(p: any) {
  return {
    id: p.id,
    name: p.full_name ?? "",
    username: p.username ?? "",
    avatar: resolveAvatarUrl(p.id, p.avatar_url, p.gender),
    verified: p.is_verified === true,
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
            data?.type === "ping"
              ? `👋 ${senderName}`
              : data?.type === "message"
                ? `New message from ${senderName}`
                : senderName;
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

/** True when the viewer is blocked either way from the peer in this 1:1 thread. */
async function isBlockedWithPeer(
  userId: string,
  conversationId: string,
  db: any = supabaseAdmin
): Promise<boolean> {
  const peers = await loadPeerByConversation(userId, [conversationId], db);
  const peerId = peers[conversationId];
  if (!peerId) return false;
  return isBlocked(userId, peerId, db);
}

/**
 * Find an exclusive 1:1 conversation between exactly these two users.
 * Never returns a multi-party thread that merely happens to include both.
 */
async function findExclusiveDmId(
  db: any,
  userId: string,
  targetId: string
): Promise<string | null> {
  // Fast path: registered pair (direct_conversation_pairs). Only trusted while
  // the conversation is still a 2-person thread of exactly these users.
  const pairedId = await getPairConversationId(userId, targetId, db);
  if (pairedId) {
    const { data: members } = await db
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", pairedId);
    const ids = new Set((members ?? []).map((m: any) => m.user_id as string));
    if ((members ?? []).length === 2 && ids.has(userId) && ids.has(targetId)) return pairedId;
  }

  const all = await listExclusiveDmIds(db, userId, targetId);
  const best = all[0]?.id ?? null;
  if (best) void setPairConversationId(userId, targetId, best, db);
  return best;
}

/**
 * Every exclusive 1:1 conversation between exactly these two users, newest
 * (updated_at) first. Usually one; more only when legacy duplicates exist.
 */
async function listExclusiveDmIds(
  db: any,
  userId: string,
  targetId: string
): Promise<{ id: string; updatedAt: number }[]> {
  const { data: myParticipations } = await db
    .from("conversation_participants")
    .select("conversation_id")
    .eq("user_id", userId);
  const myConvIds = (myParticipations ?? []).map((p: any) => p.conversation_id as string);
  if (myConvIds.length === 0) return [];

  const candidates: string[] = [];
  const chunkSize = 100;
  for (let i = 0; i < myConvIds.length; i += chunkSize) {
    const chunk = myConvIds.slice(i, i + chunkSize);
    const { data: shared } = await db
      .from("conversation_participants")
      .select("conversation_id")
      .eq("user_id", targetId)
      .in("conversation_id", chunk);
    for (const row of shared ?? []) {
      if (row.conversation_id) candidates.push(row.conversation_id);
    }
  }
  if (candidates.length === 0) return [];

  const unique = Array.from(new Set(candidates));
  const found: { id: string; updatedAt: number }[] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const [{ data: parts }, { data: convs }] = await Promise.all([
      db
        .from("conversation_participants")
        .select("conversation_id, user_id")
        .in("conversation_id", chunk),
      db.from("conversations").select("id, updated_at").in("id", chunk),
    ]);
    const byConv: Record<string, string[]> = {};
    for (const row of parts ?? []) {
      const list = byConv[row.conversation_id] ?? (byConv[row.conversation_id] = []);
      list.push(row.user_id);
    }
    const updatedAt: Record<string, number> = {};
    for (const c of convs ?? []) {
      updatedAt[c.id] = new Date(c.updated_at ?? 0).getTime();
    }
    for (const convId of chunk) {
      const members = byConv[convId] ?? [];
      if (members.length !== 2) continue;
      const set = new Set(members);
      if (!set.has(userId) || !set.has(targetId)) continue;
      found.push({ id: convId, updatedAt: updatedAt[convId] ?? 0 });
    }
  }
  found.sort((a, b) => b.updatedAt - a.updatedAt);
  return found;
}

conversationsRouter.get("/", async (c) => {
  // Auth is JWT-derived userId (set only after supabase.auth.getUser succeeds).
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  // Always use service role for the inbox so RLS on participants/messages cannot
  // return an empty list for a valid participant.
  const db = supabaseAdmin;

  try {
    // Prefer pin/hide columns; fall back if migration hasn't landed yet.
    let participations: any[] | null = null;
    let partErr: any = null;
    ({ data: participations, error: partErr } = await db
      .from("conversation_participants")
      .select("conversation_id, last_read_at, pinned_at, hidden_at")
      .eq("user_id", userId));
    if (partErr && /pinned_at|hidden_at|column/i.test(partErr.message ?? "")) {
      ({ data: participations, error: partErr } = await db
        .from("conversation_participants")
        .select("conversation_id, last_read_at")
        .eq("user_id", userId));
    }

    if (partErr) {
      console.error("[conversations] list participations error:", partErr.message);
      return c.json({ error: { message: "Failed to load conversations" } }, 500);
    }

    // Delete-for-me: hide chats the user removed from their inbox.
    const visibleParts = (participations ?? []).filter((p: any) => !p.hidden_at);
    const convIds = visibleParts.map((p: any) => p.conversation_id);
    if (convIds.length === 0) return c.json({ data: [] });

    const lastReadByConv: Record<string, string | null> = {};
    const pinnedAtByConv: Record<string, string | null> = {};
    for (const p of visibleParts) {
      lastReadByConv[p.conversation_id] = p.last_read_at ?? null;
      pinnedAtByConv[p.conversation_id] = p.pinned_at ?? null;
    }

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
    // Number of non-viewer participants — exactly 1 means an exclusive 1:1 DM.
    const otherCountByConv: Record<string, number> = {};
    for (const p of allParticipants ?? []) {
      if (!otherUserIdByConv[p.conversation_id]) otherUserIdByConv[p.conversation_id] = p.user_id;
      otherCountByConv[p.conversation_id] = (otherCountByConv[p.conversation_id] ?? 0) + 1;
    }

    const blockedSet = new Set(blockedIds);
    const visibleConversations = (conversations ?? []).filter((conv: any) => {
      const otherUserId = otherUserIdByConv[conv.id];
      return !otherUserId || !blockedSet.has(otherUserId);
    });
    const visibleIds = visibleConversations.map((c: any) => c.id);
    if (visibleIds.length === 0) return c.json({ data: [] });

    const otherUserIds: string[] = [
      ...new Set(
        visibleIds
          .map((id: string) => otherUserIdByConv[id])
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ];

    // One newest message per conversation + profiles + unread in parallel.
    // Batch last messages (avoid N+1 per conversation).
    const msgLimit = Math.min(Math.max(visibleIds.length * 40, 40), 800);
    const [lastMsgsResult, profilesResult, unreadByConv] = await Promise.all([
      db
        .from("messages")
        .select("id, conversation_id, content, created_at, sender_id, type")
        .in("conversation_id", visibleIds)
        .order("created_at", { ascending: false })
        .limit(msgLimit),
      otherUserIds.length > 0
        ? db
            .from("profiles")
            .select(
              "id, full_name, username, avatar_url, gender, bio, location, birthday, cover_url, created_at"
            )
            .in("id", otherUserIds)
        : Promise.resolve({ data: [] as any[] }),
      computeUnreadCounts(
        db,
        userId,
        visibleIds.map((id: string) => ({
          conversation_id: id,
          last_read_at: lastReadByConv[id] ?? null,
        }))
      ),
    ]);

    const profiles = profilesResult.data;
    const profilesById: Record<string, any> = {};
    for (const p of profiles ?? []) profilesById[p.id] = formatProfile(p);

    const lastMsgByConv: Record<string, any> = {};
    for (const m of lastMsgsResult.data ?? []) {
      if (m?.conversation_id && !lastMsgByConv[m.conversation_id]) {
        lastMsgByConv[m.conversation_id] = m;
      }
    }

    // Message Requests: friendship + inbound peer messages (no extra tables).
    const [friendshipByPeer, incomingByConv] = await Promise.all([
      loadFriendshipStates(userId, otherUserIds, db),
      loadConversationsWithIncoming(userId, visibleIds, db),
    ]);
    const bucketRaw = String(c.req.query("bucket") ?? "all").toLowerCase();
    const bucket = bucketRaw === "inbox" || bucketRaw === "requests" ? bucketRaw : "all";

    // Only conversations with at least one message belong in the Chats list.
    // Opening Message without sending must not create a visible empty row.
    let result: any[] = visibleConversations
      .map((conv: any) => {
        const otherUserId = otherUserIdByConv[conv.id];
        const lastMsg = lastMsgByConv[conv.id];
        if (!lastMsg) return null;
        const previewText = lastMsg?.content ?? lastMsg?.text ?? "";
        const pinnedAt = pinnedAtByConv[conv.id] ?? null;
        const friendship = otherUserId ? friendshipByPeer[otherUserId] : undefined;
        const isMessageRequest = isMessageRequestFor(friendship, incomingByConv.has(conv.id));
        return {
          id: conv.id,
          user: (otherUserId && profilesById[otherUserId]) || emptyUser(otherUserId),
          lastMessage: messagePreview(lastMsg.type, previewText),
          lastMessageTime: lastMsg.created_at ?? conv.created_at,
          lastMessageSenderId: lastMsg.sender_id ?? null,
          unreadCount: unreadByConv[conv.id] ?? 0,
          isPinned: !!pinnedAt,
          pinnedAt,
          isMessageRequest,
          friendshipStatus: friendship?.status ?? "none",
          friendshipId: friendship?.friendshipId ?? null,
          messages: [],
          // Internal (stripped below) — used to collapse duplicate 1:1 threads.
          _peerId: otherCountByConv[conv.id] === 1 ? otherUserId : null,
        };
      })
      .filter(Boolean) as any[];

    // One row per peer for exclusive 1:1 DMs: when legacy duplicates exist keep
    // the newest thread and fold unread/pin state into it. No messages are deleted.
    const dmGroups = new Map<string, any[]>();
    const deduped: any[] = [];
    for (const row of result) {
      if (row._peerId) {
        const list = dmGroups.get(row._peerId) ?? [];
        list.push(row);
        dmGroups.set(row._peerId, list);
      } else {
        deduped.push(row);
      }
    }
    for (const [peerId, list] of dmGroups) {
      if (list.length === 1) {
        deduped.push(list[0]);
        continue;
      }
      list.sort(
        (a, b) => new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
      );
      const keep = list[0];
      keep.unreadCount = list.reduce((sum, r) => sum + (r.unreadCount ?? 0), 0);
      const pinned = list.filter((r) => r.isPinned && r.pinnedAt);
      if (pinned.length > 0) {
        pinned.sort((a, b) => new Date(b.pinnedAt).getTime() - new Date(a.pinnedAt).getTime());
        keep.isPinned = true;
        keep.pinnedAt = pinned[0].pinnedAt;
      }
      // Make /start resolve to the same thread the inbox shows.
      void setPairConversationId(userId, peerId, keep.id, db);
      deduped.push(keep);
    }

    result = deduped
      .map(({ _peerId: _omit, ...row }: any) => row)
      .filter((row: any) =>
        bucket === "all" ? true : bucket === "requests" ? row.isMessageRequest : !row.isMessageRequest
      );

    // Pinned chats stay at the top; within each group sort by latest activity.
    result.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime();
    });

    return c.json({ data: result });
  } catch (err) {
    console.error("[conversations] list unexpected:", err);
    return c.json({ error: { message: "Failed to load conversations" } }, 500);
  }
});

/** Lookup an existing 1:1 conversation without creating one. Must be before /:id. */
conversationsRouter.get("/with/:userId", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const db = supabaseAdmin;
  const targetId = c.req.param("userId");
  if (!targetId || targetId === userId) {
    return c.json({ error: { message: "Invalid user" } }, 400);
  }
  if (await isBlocked(userId, targetId, db)) {
    return c.json({ error: { message: "Unable to message this user" } }, 403);
  }

  const existingConvId = await findExclusiveDmId(db, userId, targetId);
  if (!existingConvId) return c.json({ data: null });

  const { data: targetProfile } = await db.from("profiles").select("*").eq("id", targetId).maybeSingle();
  const { data: msgs } = await db
    .from("messages")
    .select("content, text, created_at, type")
    .eq("conversation_id", existingConvId)
    .order("created_at", { ascending: false })
    .limit(1);
  const lastMsg = msgs?.[0];
  const friendship = (await loadFriendshipStates(userId, [targetId], db))[targetId];
  const incoming = await loadConversationsWithIncoming(userId, [existingConvId], db);
  return c.json({
    data: {
      id: existingConvId,
      user: targetProfile ? formatProfile(targetProfile) : emptyUser(targetId),
      lastMessage: lastMsg ? messagePreview(lastMsg.type, lastMsg.content ?? lastMsg.text) : "",
      lastMessageTime: lastMsg?.created_at ?? new Date().toISOString(),
      unreadCount: 0,
      messages: [],
      hasMessages: !!lastMsg,
      isMessageRequest: isMessageRequestFor(friendship, incoming.has(existingConvId)),
      friendshipStatus: friendship?.status ?? "none",
      friendshipId: friendship?.friendshipId ?? null,
    },
  });
});

conversationsRouter.get("/:id", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  // Always use service role for chat reads so both participants can open the
  // same conversation even when RLS on participants is incomplete.
  const db = supabaseAdmin;
  const { id } = c.req.param();

  // Security + my read cursor in one round-trip.
  const { data: participation } = await db
    .from("conversation_participants")
    .select("user_id, last_read_at")
    .eq("conversation_id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!participation) return c.json({ error: { message: "Not found" } }, 404);
  const myLastReadAt: string | null = participation.last_read_at ?? null;

  const rawLimit = Number(c.req.query("limit") ?? 12);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 40) : 12;
  const before = c.req.query("before"); // older page (exclusive upper bound)
  const after = c.req.query("after"); // newer page (exclusive lower bound)

  const findFirstUnread = async (): Promise<{ id: string; created_at: string } | null> => {
    let q = db
      .from("messages")
      .select("id, created_at")
      .eq("conversation_id", id)
      .neq("sender_id", userId)
      .order("created_at", { ascending: true })
      .limit(1);
    if (myLastReadAt) q = q.gt("created_at", myLastReadAt);
    const { data } = await q;
    return (data?.[0] as { id: string; created_at: string } | undefined) ?? null;
  };

  type MsgPage = {
    msgs: any[];
    hasMore: boolean;
    hasMoreNewer: boolean;
    firstUnreadMessageId: string | null;
    unreadCount: number;
  };

  const loadAfterPage = async (): Promise<MsgPage> => {
    const { data } = await db
      .from("messages")
      .select("*")
      .eq("conversation_id", id)
      .gt("created_at", after!)
      .order("created_at", { ascending: true })
      .limit(limit + 1);
    const rows = data ?? [];
    const hasMoreNewer = rows.length > limit;
    return {
      msgs: hasMoreNewer ? rows.slice(0, limit) : rows,
      hasMore: false,
      hasMoreNewer,
      firstUnreadMessageId: null,
      unreadCount: 0,
    };
  };

  const loadBeforePage = async (): Promise<MsgPage> => {
    const { data } = await db
      .from("messages")
      .select("*")
      .eq("conversation_id", id)
      .lt("created_at", before!)
      .order("created_at", { ascending: false })
      .limit(limit + 1);
    const newestFirst = data ?? [];
    const hasMore = newestFirst.length > limit;
    const pageNewestFirst = hasMore ? newestFirst.slice(0, limit) : newestFirst;
    return {
      msgs: pageNewestFirst.slice().reverse(),
      hasMore,
      hasMoreNewer: false,
      firstUnreadMessageId: null,
      unreadCount: 0,
    };
  };

  const loadUnreadForward = async (
    firstUnread: { id: string; created_at: string }
  ): Promise<MsgPage> => {
    const [{ data: forward }, olderCheck, countRes] = await Promise.all([
      db
        .from("messages")
        .select("*")
        .eq("conversation_id", id)
        .gte("created_at", firstUnread.created_at)
        .order("created_at", { ascending: true })
        .limit(limit + 1),
      db
        .from("messages")
        .select("id")
        .eq("conversation_id", id)
        .lt("created_at", firstUnread.created_at)
        .limit(1)
        .maybeSingle(),
      (async () => {
        let countQuery = db
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", id)
          .neq("sender_id", userId);
        if (myLastReadAt) countQuery = countQuery.gt("created_at", myLastReadAt);
        return countQuery;
      })(),
    ]);
    const rows = forward ?? [];
    const hasMoreNewer = rows.length > limit;
    return {
      msgs: hasMoreNewer ? rows.slice(0, limit) : rows,
      hasMore: !!olderCheck.data,
      hasMoreNewer,
      firstUnreadMessageId: firstUnread.id,
      unreadCount: countRes.count ?? 0,
    };
  };

  const loadNewestPage = async (): Promise<MsgPage> => {
    const { data: newestFirst } = await db
      .from("messages")
      .select("*")
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .limit(limit + 1);
    const rows = newestFirst ?? [];
    const hasMore = rows.length > limit;
    const pageNewestFirst = hasMore ? rows.slice(0, limit) : rows;
    return {
      msgs: pageNewestFirst.slice().reverse(),
      hasMore,
      hasMoreNewer: false,
      firstUnreadMessageId: null,
      unreadCount: 0,
    };
  };

  // Batch 1: conversation + other participants (+ paginated messages when scrolling).
  // Initial open always loads the newest page (end of chat) — never the full history
  // or an unread-forward window that jumps mid-thread.
  const [convResult, othersResult, batch1] = await Promise.all([
    db.from("conversations").select("*").eq("id", id).single(),
    db
      .from("conversation_participants")
      .select("user_id, last_read_at")
      .eq("conversation_id", id)
      .neq("user_id", userId),
    after
      ? loadAfterPage()
      : before
        ? loadBeforePage()
        : loadNewestPage(),
  ]);

  const conv = convResult.data;
  if (!conv) return c.json({ error: { message: "Not found" } }, 404);

  const participants = othersResult.data ?? [];
  const otherUserId = participants[0]?.user_id;
  const otherLastReadAt =
    participants.reduce<string | null>((min, p: any) => {
      const v = p.last_read_at ?? null;
      if (v === null) return null;
      if (min === undefined) return v;
      return min === null ? null : v < min ? v : min;
    }, undefined as any) ?? null;

  // Batch 2: profile (+ unread metadata for the initial newest-page open).
  const profilePromise = otherUserId
    ? db.from("profiles").select("*").eq("id", otherUserId).single()
    : Promise.resolve({ data: null });

  let msgPage: MsgPage;
  let otherUser: ReturnType<typeof formatProfile> | null = null;
  if (after || before) {
    msgPage = batch1 as MsgPage;
    const { data: profile } = await profilePromise;
    otherUser = profile ? formatProfile(profile) : null;
  } else {
    const newestPage = batch1 as MsgPage;
    const threadIsEmpty = newestPage.msgs.length === 0;
    const [profileResult, firstUnread, unreadCountRes] = await Promise.all([
      profilePromise,
      threadIsEmpty ? Promise.resolve(null) : findFirstUnread(),
      (async () => {
        if (threadIsEmpty) return { count: 0 };
        let countQuery = db
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", id)
          .neq("sender_id", userId);
        if (myLastReadAt) countQuery = countQuery.gt("created_at", myLastReadAt);
        return countQuery;
      })(),
    ]);
    msgPage = {
      ...newestPage,
      firstUnreadMessageId: firstUnread?.id ?? null,
      unreadCount: unreadCountRes.count ?? 0,
    };
    otherUser = profileResult.data ? formatProfile(profileResult.data) : null;
  }

  const { msgs, hasMore, hasMoreNewer, firstUnreadMessageId, unreadCount } = msgPage;
  const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
  const oldest = msgs.length > 0 ? msgs[0] : null;
  const newest = last;
  const nextBefore = hasMore && oldest?.created_at ? String(oldest.created_at) : null;
  const nextAfter = hasMoreNewer && newest?.created_at ? String(newest.created_at) : null;
  const mapped = await attachReplyPreviews(db, msgs.map((m: any) => mapMessage(m)), msgs);

  // Message Request state: only when the peer has messaged and you are not friends.
  let friendship: Awaited<ReturnType<typeof loadFriendshipStates>>[string] | undefined;
  let hasIncomingFromPeer = false;
  if (otherUserId) {
    friendship = (await loadFriendshipStates(userId, [otherUserId], db))[otherUserId];
    const incoming = await loadConversationsWithIncoming(userId, [id], db);
    hasIncomingFromPeer = incoming.has(id);
  }
  const isMessageRequest = otherUserId
    ? isMessageRequestFor(friendship, hasIncomingFromPeer)
    : false;

  return c.json({
    data: {
      id: conv.id,
      user: otherUser ?? emptyUser(),
      lastMessage: last ? messagePreview(last.type, last.content) : "",
      lastMessageTime: conv.updated_at,
      unreadCount,
      isMessageRequest,
      friendshipStatus: friendship?.status ?? "none",
      friendshipId: friendship?.friendshipId ?? null,
      myLastReadAt,
      firstUnreadMessageId,
      otherLastReadAt,
      messages: mapped,
      hasMore,
      hasMoreNewer,
      nextBefore,
      nextAfter,
      nextCursor: nextBefore,
      limit,
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

  const result = await computeUnreadCounts(db, userId, participations ?? []);

  // Threads with blocked people are hidden from the inbox — never count their unreads.
  try {
    const unreadIds = Object.keys(result).filter((id) => (result[id] ?? 0) > 0);
    if (unreadIds.length > 0) {
      const [peerByConv, blockedIds] = await Promise.all([
        loadPeerByConversation(userId, unreadIds, db),
        getBlockedIds(userId, db),
      ]);
      const blocked = new Set(blockedIds);
      for (const convId of unreadIds) {
        const peer = peerByConv[convId];
        if (peer && blocked.has(peer)) result[convId] = 0;
      }
    }
  } catch (e) {
    console.warn("[conversations] unread-counts block filter failed:", e);
  }

  return c.json({ data: result });
});

/** Hide conversations for the current user only (delete-for-me). */
async function hideConversationsForUser(
  db: typeof supabaseAdmin,
  userId: string,
  ids: string[]
): Promise<{ ok: boolean; error?: string; deleted: number }> {
  const unique = Array.from(new Set(ids.filter((id) => typeof id === "string" && id.length > 0)));
  if (unique.length === 0) return { ok: true, deleted: 0 };
  const now = new Date().toISOString();

  // Update without .select() first — some PostgREST configs fail RETURNING even when UPDATE works.
  let { error } = await db
    .from("conversation_participants")
    .update({ hidden_at: now, pinned_at: null })
    .eq("user_id", userId)
    .in("conversation_id", unique);

  if (error && /pinned_at|column/i.test(error.message ?? "")) {
    ({ error } = await db
      .from("conversation_participants")
      .update({ hidden_at: now })
      .eq("user_id", userId)
      .in("conversation_id", unique));
  }

  if (error) {
    console.error("[conversations] hide failed:", error.message);
    return { ok: false, error: error.message, deleted: 0 };
  }

  // Best-effort count (do not fail the request if this probe errors).
  const { data: hiddenRows } = await db
    .from("conversation_participants")
    .select("conversation_id")
    .eq("user_id", userId)
    .in("conversation_id", unique)
    .not("hidden_at", "is", null);

  return { ok: true, deleted: (hiddenRows ?? []).length || unique.length };
}

/** Unhide a chat for everyone except optionally one user — used when a new message arrives. */
async function unhideConversationForOthers(
  db: typeof supabaseAdmin,
  conversationId: string,
  exceptUserId?: string
): Promise<void> {
  try {
    let q = db
      .from("conversation_participants")
      .update({ hidden_at: null })
      .eq("conversation_id", conversationId)
      .not("hidden_at", "is", null);
    if (exceptUserId) q = q.neq("user_id", exceptUserId);
    await q;
  } catch (e) {
    console.warn(
      "[conversations] unhide skipped:",
      e instanceof Error ? e.message : e
    );
  }
}

function hideErrorResponse(c: any, msg: string) {
  const status = /column|hidden_at|pinned_at/i.test(msg) ? 503 : 500;
  return c.json(
    {
      error: {
        message:
          status === 503
            ? "Chat delete is not available yet. Please try again."
            : msg || "Failed to delete conversation",
      },
    },
    status
  );
}

// POST /api/conversations/hide — bulk delete-for-me (must be before /:id routes).
conversationsRouter.post("/hide", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  // Best-effort schema ensure — still attempt hide if probe fails.
  await ensureInboxColumns();

  const body = await c.req.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids)
    ? body.ids
    : typeof body?.id === "string"
      ? [body.id]
      : [];
  if (ids.length === 0) {
    return c.json({ error: { message: "No conversations selected" } }, 400);
  }
  const result = await hideConversationsForUser(supabaseAdmin, userId, ids);
  if (!result.ok) return hideErrorResponse(c, result.error ?? "Failed to delete conversations");
  return c.json({ data: { ok: true, deleted: result.deleted } });
});

// POST /api/conversations/:id/hide — single-chat delete-for-me alias.
conversationsRouter.post("/:id/hide", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  await ensureInboxColumns();

  const { id } = c.req.param();
  const { data: participation } = await supabaseAdmin
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!participation) return c.json({ error: { message: "Unauthorized" } }, 403);

  const result = await hideConversationsForUser(supabaseAdmin, userId, [id]);
  if (!result.ok) return hideErrorResponse(c, result.error ?? "Failed to delete conversation");
  return c.json({ data: { ok: true, id, deleted: result.deleted } });
});

// DELETE /api/conversations/:id — delete-for-me (hide from this user's inbox).
conversationsRouter.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  await ensureInboxColumns();

  const { id } = c.req.param();
  const { data: participation } = await supabaseAdmin
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!participation) return c.json({ error: { message: "Unauthorized" } }, 403);

  const result = await hideConversationsForUser(supabaseAdmin, userId, [id]);
  if (!result.ok) return hideErrorResponse(c, result.error ?? "Failed to delete conversation");
  return c.json({ data: { ok: true, id } });
});

// POST /api/conversations/:id/pin — pin or unpin for the current user.
conversationsRouter.post("/:id/pin", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  await ensureInboxColumns();

  const { id } = c.req.param();
  const body = await c.req.json().catch(() => ({}));

  const { data: participation, error: partErr } = await supabaseAdmin
    .from("conversation_participants")
    .select("user_id, pinned_at, hidden_at")
    .eq("conversation_id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (partErr) {
    console.error("[conversations] pin select failed:", partErr.message);
    const status = /column|pinned_at|hidden_at/i.test(partErr.message ?? "") ? 503 : 500;
    return c.json(
      {
        error: {
          message:
            status === 503
              ? "Pinning is not available yet. Please try again."
              : "Failed to update pin",
        },
      },
      status
    );
  }
  if (!participation) return c.json({ error: { message: "Unauthorized" } }, 403);

  const wantPinned =
    typeof body?.pinned === "boolean" ? body.pinned : !participation.pinned_at;
  const pinnedAt = wantPinned ? new Date().toISOString() : null;

  // Update without RETURNING — some PostgREST configs fail .select().single() even when UPDATE works.
  const { error } = await supabaseAdmin
    .from("conversation_participants")
    .update({
      pinned_at: pinnedAt,
      // Pinning a hidden chat brings it back.
      hidden_at: wantPinned ? null : participation.hidden_at ?? null,
    })
    .eq("conversation_id", id)
    .eq("user_id", userId);

  if (error) {
    console.error("[conversations] pin failed:", error.message);
    const status = /column|pinned_at|hidden_at/i.test(error.message ?? "") ? 503 : 500;
    return c.json(
      {
        error: {
          message:
            status === 503
              ? "Pinning is not available yet. Please try again."
              : error.message || "Failed to update pin",
        },
      },
      status
    );
  }

  return c.json({
    data: {
      id,
      isPinned: wantPinned,
      pinnedAt,
    },
  });
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

  // The inbox folds legacy duplicate 1:1 threads into one row (unread summed),
  // so reading it must also clear the hidden duplicates with the same peer.
  try {
    const peers = await loadPeerByConversation(userId, [id], db);
    const peerId = peers[id];
    if (peerId) {
      const exclusive = (await listExclusiveDmIds(db, userId, peerId)).map((s) => s.id);
      // Only when this thread is itself an exclusive DM (never for group chats).
      const siblings = exclusive.includes(id) ? exclusive.filter((sid) => sid !== id) : [];
      if (siblings.length > 0 && siblings.length < 50) {
        await db
          .from("conversation_participants")
          .update({ last_read_at: new Date().toISOString() })
          .in("conversation_id", siblings)
          .eq("user_id", userId);
      }
    }
  } catch (e) {
    console.warn("[conversations] sibling read failed:", e instanceof Error ? e.message : e);
  }

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
  // New activity brings the chat back for recipients who deleted-for-me.
  void unhideConversationForOthers(db, id, userId);

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
  // Optional: lookup-only (no insert) so opening Message never creates empties.
  const createIfMissing = c.req.query("create") !== "0";
  console.log(`[conversations/start] userId=${userId} targetId=${targetId} create=${createIfMissing}`);

  if (!targetId || targetId === userId) {
    return c.json({ error: { message: "Cannot start a conversation with yourself" } }, 400);
  }

  // No messaging across a block (either direction).
  if (await isBlocked(userId, targetId, db)) {
    return c.json({ error: { message: "Unable to message this user" } }, 403);
  }

  // Exclusive 1:1 only — never reuse a multi-party conversation that happens
  // to include both users.
  const existingConvId = await findExclusiveDmId(db, userId, targetId);
  console.log(
    `[conversations/start] exclusive match=${existingConvId ?? "none"}`
  );

  if (existingConvId) {
    console.log(`[conversations/start] existing conv found: ${existingConvId}`);
    // Repair only when a participant row is missing on a confirmed 2-person DM.
    const { data: parts } = await db
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", existingConvId);
    const present = new Set((parts ?? []).map((p: any) => p.user_id));
    if (present.size <= 2 && !present.has(userId)) {
      await db.from("conversation_participants").insert({ conversation_id: existingConvId, user_id: userId });
    }
    if (present.size <= 2 && !present.has(targetId)) {
      await db.from("conversation_participants").insert({ conversation_id: existingConvId, user_id: targetId });
    }

    // Re-opening a chat from a profile unhides it for the opener.
    await db
      .from("conversation_participants")
      .update({ hidden_at: null })
      .eq("conversation_id", existingConvId)
      .eq("user_id", userId);

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

  if (!createIfMissing) {
    return c.json({ data: null });
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

  // Register the pair. If a concurrent request already created the DM, discard
  // this brand-new (message-less) thread and return the registered one instead.
  let ownerId = await claimPairConversation(userId, targetId, newConv.id, db);
  if (ownerId !== newConv.id) {
    // Guard against a stale pointer (e.g. participants removed): only yield to a
    // registered thread that is still a 2-person DM of exactly these users.
    const { data: ownerMembers } = await db
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", ownerId);
    const memberIds = new Set((ownerMembers ?? []).map((m: any) => m.user_id as string));
    const ownerValid = (ownerMembers ?? []).length === 2 && memberIds.has(userId) && memberIds.has(targetId);
    if (!ownerValid) {
      await setPairConversationId(userId, targetId, newConv.id, db);
      ownerId = newConv.id;
    }
  }
  if (ownerId !== newConv.id) {
    console.log(`[conversations/start] lost pair race; using ${ownerId}, dropping ${newConv.id}`);
    await db.from("conversation_participants").delete().eq("conversation_id", newConv.id);
    await db.from("conversations").delete().eq("id", newConv.id);
    await db
      .from("conversation_participants")
      .update({ hidden_at: null })
      .eq("conversation_id", ownerId)
      .eq("user_id", userId);
    const { data: ownerConv } = await db.from("conversations").select("*").eq("id", ownerId).maybeSingle();
    const { data: ownerProfile } = await db.from("profiles").select("*").eq("id", targetId).single();
    return c.json({
      data: {
        id: ownerId,
        user: ownerProfile ? formatProfile(ownerProfile) : emptyUser(targetId),
        lastMessage: "",
        lastMessageTime: ownerConv?.updated_at ?? new Date().toISOString(),
        unreadCount: 0,
        messages: [],
      },
    });
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

  if (await isBlockedWithPeer(userId, id, db)) {
    return c.json({ error: { message: "Unable to message this user" } }, 403);
  }

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
  void unhideConversationForOthers(db, id, userId);

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
