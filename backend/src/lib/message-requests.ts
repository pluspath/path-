import { supabaseAdmin } from "../supabase";

/**
 * Message Requests are DERIVED from friendship state — there is no extra table.
 * A 1:1 conversation with at least one message is a "message request" for as long
 * as the two participants are not accepted friends. When the friendship becomes
 * `accepted`, the next read simply reports `isMessageRequest: false`.
 */

export type FriendshipState = "friends" | "pending_sent" | "pending_received" | "none";

export type FriendshipInfo = {
  status: FriendshipState;
  friendshipId: string | null;
};

const NONE: FriendshipInfo = { status: "none", friendshipId: null };

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Batch-load friendship state (accepted / pending either way) for many peers. */
export async function loadFriendshipStates(
  userId: string,
  peerIds: string[],
  db: any = supabaseAdmin
): Promise<Record<string, FriendshipInfo>> {
  const result: Record<string, FriendshipInfo> = {};
  const unique = Array.from(new Set(peerIds.filter((id) => !!id && id !== userId)));
  for (const id of unique) result[id] = NONE;
  if (unique.length === 0) return result;

  for (const ids of chunk(unique, 80)) {
    const [sent, received] = await Promise.all([
      db
        .from("friendships")
        .select("id, receiver_id, status")
        .eq("requester_id", userId)
        .in("receiver_id", ids)
        .in("status", ["accepted", "pending"]),
      db
        .from("friendships")
        .select("id, requester_id, status")
        .eq("receiver_id", userId)
        .in("requester_id", ids)
        .in("status", ["accepted", "pending"]),
    ]);
    if (sent.error) {
      console.warn("[message-requests] sent friendships query failed:", sent.error.message);
    }
    if (received.error) {
      console.warn("[message-requests] received friendships query failed:", received.error.message);
    }

    for (const row of sent.data ?? []) {
      const peer = row.receiver_id as string;
      const status: FriendshipState = row.status === "accepted" ? "friends" : "pending_sent";
      // `friends` always wins if duplicate rows ever exist.
      if (result[peer]?.status !== "friends") result[peer] = { status, friendshipId: row.id };
    }
    for (const row of received.data ?? []) {
      const peer = row.requester_id as string;
      const status: FriendshipState = row.status === "accepted" ? "friends" : "pending_received";
      if (result[peer]?.status !== "friends") result[peer] = { status, friendshipId: row.id };
    }
  }
  return result;
}

/** Map conversationId -> the other participant's user id (1:1 threads). */
export async function loadPeerByConversation(
  userId: string,
  convIds: string[],
  db: any = supabaseAdmin
): Promise<Record<string, string>> {
  const peerByConv: Record<string, string> = {};
  const unique = Array.from(new Set(convIds.filter(Boolean)));
  for (const ids of chunk(unique, 100)) {
    const { data, error } = await db
      .from("conversation_participants")
      .select("conversation_id, user_id")
      .in("conversation_id", ids)
      .neq("user_id", userId);
    if (error) {
      console.warn("[message-requests] peer lookup failed:", error.message);
      continue;
    }
    for (const row of data ?? []) {
      if (!peerByConv[row.conversation_id]) peerByConv[row.conversation_id] = row.user_id;
    }
  }
  return peerByConv;
}

/**
 * Is this thread a Message Request for the viewer?
 * Only inbound non-friend threads count — the recipient sees Requests;
 * the sender keeps the thread in their regular inbox until they are friends.
 * `hasIncomingFromPeer` = the peer has sent at least one message in the thread.
 */
export function isMessageRequestFor(
  info: FriendshipInfo | undefined,
  hasIncomingFromPeer: boolean
): boolean {
  return hasIncomingFromPeer && (info?.status ?? "none") !== "friends";
}

/** Conversation ids where someone other than `userId` has sent a message. */
export async function loadConversationsWithIncoming(
  userId: string,
  convIds: string[],
  db: any = supabaseAdmin
): Promise<Set<string>> {
  const incoming = new Set<string>();
  const unique = Array.from(new Set(convIds.filter(Boolean)));
  if (unique.length === 0) return incoming;
  for (const ids of chunk(unique, 80)) {
    const { data, error } = await db
      .from("messages")
      .select("conversation_id")
      .in("conversation_id", ids)
      .neq("sender_id", userId);
    if (error) {
      console.warn("[message-requests] incoming lookup failed:", error.message);
      continue;
    }
    for (const row of data ?? []) {
      if (row.conversation_id) incoming.add(row.conversation_id);
    }
  }
  return incoming;
}
