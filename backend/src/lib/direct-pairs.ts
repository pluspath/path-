import { supabaseAdmin } from "../supabase";

/**
 * Best-effort helpers for `public.direct_conversation_pairs` (see migration
 * 018_direct_conversation_pairs.sql). The table maps an unordered pair of users
 * to ONE exclusive 1:1 conversation.
 *
 * Every helper swallows errors: when the table has not been migrated yet the app
 * silently falls back to the participant scan in conversations.ts.
 */

/** Canonical (user_a < user_b) ordering, matching the table's CHECK constraint. */
export function orderPair(a: string, b: string): { user_a: string; user_b: string } {
  const x = String(a).toLowerCase();
  const y = String(b).toLowerCase();
  return x < y ? { user_a: x, user_b: y } : { user_a: y, user_b: x };
}

/** Conversation id registered for this pair, or null (also null if table missing). */
export async function getPairConversationId(
  a: string,
  b: string,
  db: any = supabaseAdmin
): Promise<string | null> {
  try {
    const { user_a, user_b } = orderPair(a, b);
    const { data, error } = await db
      .from("direct_conversation_pairs")
      .select("conversation_id")
      .eq("user_a", user_a)
      .eq("user_b", user_b)
      .maybeSingle();
    if (error || !data?.conversation_id) return null;
    return String(data.conversation_id);
  } catch {
    return null;
  }
}

/** Point the pair at `conversationId` (overwrites). Never throws. */
export async function setPairConversationId(
  a: string,
  b: string,
  conversationId: string,
  db: any = supabaseAdmin
): Promise<void> {
  try {
    const { user_a, user_b } = orderPair(a, b);
    await db
      .from("direct_conversation_pairs")
      .upsert(
        { user_a, user_b, conversation_id: conversationId, updated_at: new Date().toISOString() },
        { onConflict: "user_a,user_b" }
      );
  } catch {
    /* table missing — app-level dedupe still applies */
  }
}

/**
 * Atomically register a freshly created conversation for the pair.
 * Returns the id that owns the pair: `conversationId` when we won (or the table
 * is unavailable), otherwise the id another request registered first.
 */
export async function claimPairConversation(
  a: string,
  b: string,
  conversationId: string,
  db: any = supabaseAdmin
): Promise<string> {
  try {
    const { user_a, user_b } = orderPair(a, b);
    const { error } = await db
      .from("direct_conversation_pairs")
      .insert({ user_a, user_b, conversation_id: conversationId });
    if (!error) return conversationId;
    // Unique violation => someone else already owns the pair.
    if (error.code === "23505" || /duplicate key/i.test(error.message ?? "")) {
      const existing = await getPairConversationId(a, b, db);
      return existing ?? conversationId;
    }
    return conversationId; // table missing or other failure — don't block creation
  } catch {
    return conversationId;
  }
}
