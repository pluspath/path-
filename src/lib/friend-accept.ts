import { withDirectSql } from "./direct-db";
import {
  FRIEND_LIMIT_CODE,
  MAX_ACCEPTED_FRIENDS,
  friendLimitMessage,
  wouldExceedFriendLimit,
} from "./friend-limit";
import { supabaseAdmin } from "../supabase";

export type AcceptFriendshipResult =
  | { ok: true; friendship: Record<string, unknown> }
  | { ok: false; status: 400 | 404 | 500; code?: string; message: string };

async function countAccepted(userId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("friendships")
    .select("id", { count: "exact", head: true })
    .eq("status", "accepted")
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Accept a pending friendship with concurrency-safe limit checks.
 * Prefer a Postgres transaction + advisory locks; fall back to admin client +
 * DB trigger when DIRECT_URL / DATABASE_URL is unavailable.
 */
export async function acceptFriendshipSecurely(params: {
  friendshipId: string;
  accepterId: string;
}): Promise<AcceptFriendshipResult> {
  const { friendshipId, accepterId } = params;

  const viaSql = await withDirectSql(async (sql) => {
    return sql.begin(async (tx) => {
      const rows = await tx`
        SELECT id, requester_id, receiver_id, status
        FROM public.friendships
        WHERE id = ${friendshipId}::uuid
        FOR UPDATE
      `;
      const row = rows[0] as
        | {
            id: string;
            requester_id: string;
            receiver_id: string;
            status: string;
          }
        | undefined;

      if (!row) {
        return { ok: false as const, status: 404 as const, message: "Not found" };
      }
      if (row.receiver_id !== accepterId) {
        return { ok: false as const, status: 404 as const, message: "Not found" };
      }
      if (row.status === "accepted") {
        const full = await tx`SELECT * FROM public.friendships WHERE id = ${friendshipId}::uuid`;
        return { ok: true as const, friendship: (full[0] ?? row) as Record<string, unknown> };
      }
      if (row.status !== "pending") {
        return { ok: false as const, status: 404 as const, message: "Not found" };
      }

      const a = row.requester_id;
      const b = row.receiver_id;
      // Lock both participants in a stable order to prevent concurrent accepts
      // from pushing either side past the accepted-friends cap.
      const left = a < b ? a : b;
      const right = a < b ? b : a;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${left}::text, 0))`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${right}::text, 0))`;

      const counts = await tx`
        SELECT
          (
            SELECT COUNT(*)::int FROM public.friendships
            WHERE status = 'accepted'
              AND (requester_id = ${a}::uuid OR receiver_id = ${a}::uuid)
          ) AS requester_count,
          (
            SELECT COUNT(*)::int FROM public.friendships
            WHERE status = 'accepted'
              AND (requester_id = ${b}::uuid OR receiver_id = ${b}::uuid)
          ) AS receiver_count
      `;
      const requesterCount = Number(counts[0]?.requester_count ?? 0);
      const receiverCount = Number(counts[0]?.receiver_count ?? 0);

      if (
        wouldExceedFriendLimit(requesterCount) ||
        wouldExceedFriendLimit(receiverCount)
      ) {
        return {
          ok: false as const,
          status: 400 as const,
          code: FRIEND_LIMIT_CODE,
          message: friendLimitMessage(MAX_ACCEPTED_FRIENDS),
        };
      }

      const updated = await tx`
        UPDATE public.friendships
        SET status = 'accepted',
            accepted_at = COALESCE(accepted_at, now())
        WHERE id = ${friendshipId}::uuid
          AND status = 'pending'
        RETURNING *
      `;
      const friendship = updated[0] as Record<string, unknown> | undefined;
      if (!friendship) {
        return { ok: false as const, status: 404 as const, message: "Not found" };
      }
      return { ok: true as const, friendship };
    });
  });

  if (viaSql) return viaSql;

  // Fallback without direct SQL: check counts then update. DB trigger remains the
  // last line of defense against races.
  const { data: friendship, error: loadErr } = await supabaseAdmin
    .from("friendships")
    .select("*")
    .eq("id", friendshipId)
    .maybeSingle();

  if (loadErr) {
    return { ok: false, status: 500, message: "Failed to accept request" };
  }
  if (!friendship || friendship.receiver_id !== accepterId) {
    return { ok: false, status: 404, message: "Not found" };
  }
  if (friendship.status === "accepted") {
    return { ok: true, friendship };
  }
  if (friendship.status !== "pending") {
    return { ok: false, status: 404, message: "Not found" };
  }

  try {
    const [requesterCount, receiverCount] = await Promise.all([
      countAccepted(friendship.requester_id),
      countAccepted(friendship.receiver_id),
    ]);
    if (wouldExceedFriendLimit(requesterCount) || wouldExceedFriendLimit(receiverCount)) {
      return {
        ok: false,
        status: 400,
        code: FRIEND_LIMIT_CODE,
        message: friendLimitMessage(MAX_ACCEPTED_FRIENDS),
      };
    }
  } catch (e) {
    console.error("[friends/accept] count failed:", e);
    return { ok: false, status: 500, message: "Failed to accept request" };
  }

  let { data: updated, error } = await supabaseAdmin
    .from("friendships")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", friendshipId)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  // Pre-migration DBs may lack accepted_at; retry with status only.
  if (error && /accepted_at|column/i.test(error.message)) {
    ({ data: updated, error } = await supabaseAdmin
      .from("friendships")
      .update({ status: "accepted" })
      .eq("id", friendshipId)
      .eq("status", "pending")
      .select()
      .maybeSingle());
  }

  if (error) {
    if (/friend_limit|FRIEND_LIMIT|maximum of/i.test(error.message)) {
      return {
        ok: false,
        status: 400,
        code: FRIEND_LIMIT_CODE,
        message: friendLimitMessage(MAX_ACCEPTED_FRIENDS),
      };
    }
    console.error("[friends/accept] update failed:", error.message);
    return { ok: false, status: 500, message: "Failed to accept request" };
  }
  if (!updated) {
    return { ok: false, status: 404, message: "Not found" };
  }
  return { ok: true, friendship: updated };
}
