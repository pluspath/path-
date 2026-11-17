import { withDirectSql } from "./direct-db";

export type UnreadParticipation = {
  conversation_id: string;
  last_read_at?: string | null;
};

/**
 * One GROUP BY aggregate for unread DMs across the given conversations.
 * Returns null when DIRECT_URL/DATABASE_URL is unavailable so callers can
 * fall back to PostgREST exact COUNTs.
 */
export async function countUnreadByConversationDirect(
  userId: string,
  conversationIds: string[]
): Promise<Record<string, number> | null> {
  const convIds = conversationIds.filter(Boolean);
  if (convIds.length === 0) return {};

  try {
    const rows = await withDirectSql(async (sql) => {
      // postgres.js: use sql.array() for UUID[] binds (raw JS arrays fail the cast).
      return (await sql`
        SELECT m.conversation_id::text AS conversation_id, COUNT(*)::int AS unread
        FROM conversation_participants cp
        INNER JOIN messages m ON m.conversation_id = cp.conversation_id
        WHERE cp.user_id = ${userId}::uuid
          AND cp.hidden_at IS NULL
          AND m.conversation_id = ANY(${sql.array(convIds)}::uuid[])
          AND m.sender_id <> ${userId}::uuid
          AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
        GROUP BY m.conversation_id
      `) as { conversation_id: string; unread: number }[];
    });
    if (!rows) return null;
    const out: Record<string, number> = {};
    for (const row of rows) {
      if (row?.conversation_id) out[String(row.conversation_id)] = Number(row.unread) || 0;
    }
    return out;
  } catch (e) {
    console.warn(
      "[unread] direct aggregate failed:",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

/**
 * Exact unread DM counts — prefers one SQL aggregate, falls back to chunked
 * PostgREST COUNTs (never undercounts from row caps).
 */
export async function computeUnreadCountsBatched(
  db: any,
  userId: string,
  participations: UnreadParticipation[]
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const p of participations) {
    result[p.conversation_id] = 0;
  }
  if (participations.length === 0) return result;

  const direct = await countUnreadByConversationDirect(
    userId,
    participations.map((p) => p.conversation_id)
  );
  if (direct) {
    for (const p of participations) {
      result[p.conversation_id] = direct[p.conversation_id] ?? 0;
    }
    return result;
  }

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
          console.warn("[unread] count failed:", error.message);
          return;
        }
        result[p.conversation_id] = count ?? 0;
      })
    );
  }
  return result;
}
