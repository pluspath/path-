import { supabaseAdmin } from "../supabase";
import { withDirectSql } from "./direct-db";

/** Users are "online" when their last heartbeat is within this window. */
export const PRESENCE_ACTIVE_WINDOW_MS = 3 * 60 * 1000;

/**
 * Upsert the caller's last_seen_at. Prefer a single-row upsert via PostgREST;
 * fall back to direct SQL when the circuit / schema cache is degraded.
 */
export async function heartbeatPresence(
  userId: string,
  client: string = "mobile"
): Promise<{ ok: boolean; lastSeenAt: string }> {
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin.from("user_presence").upsert(
    {
      user_id: userId,
      last_seen_at: now,
      client,
      updated_at: now,
    },
    { onConflict: "user_id" }
  );

  if (!error) return { ok: true, lastSeenAt: now };

  const viaSql = await withDirectSql(async (sql) => {
    await sql`
      INSERT INTO public.user_presence (user_id, last_seen_at, client, updated_at)
      VALUES (${userId}::uuid, ${now}::timestamptz, ${client}, ${now}::timestamptz)
      ON CONFLICT (user_id) DO UPDATE
      SET last_seen_at = EXCLUDED.last_seen_at,
          client = EXCLUDED.client,
          updated_at = EXCLUDED.updated_at
    `;
    return true;
  });

  if (viaSql) return { ok: true, lastSeenAt: now };

  console.warn("[presence] heartbeat failed:", error?.message ?? "unknown");
  return { ok: false, lastSeenAt: now };
}

export type LivePresenceStats = {
  onlineUsers: number;
  windowSeconds: number;
  asOf: string;
  available: boolean;
};

/** Count unique users with a recent mobile (or any) heartbeat. */
export async function getLivePresenceStats(): Promise<LivePresenceStats> {
  const asOf = new Date().toISOString();
  const windowSeconds = Math.round(PRESENCE_ACTIVE_WINDOW_MS / 1000);
  const since = new Date(Date.now() - PRESENCE_ACTIVE_WINDOW_MS).toISOString();

  const { count, error } = await supabaseAdmin
    .from("user_presence")
    .select("user_id", { count: "exact", head: true })
    .gte("last_seen_at", since);

  if (!error && typeof count === "number") {
    return {
      onlineUsers: count,
      windowSeconds,
      asOf,
      available: true,
    };
  }

  const viaSql = await withDirectSql(async (sql) => {
    const rows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM public.user_presence
      WHERE last_seen_at >= ${since}::timestamptz
    `;
    return Number(rows[0]?.count ?? 0);
  });

  if (viaSql !== null) {
    return {
      onlineUsers: viaSql,
      windowSeconds,
      asOf,
      available: true,
    };
  }

  console.warn("[presence] live count failed:", error?.message ?? "unavailable");
  return {
    onlineUsers: 0,
    windowSeconds,
    asOf,
    available: false,
  };
}
