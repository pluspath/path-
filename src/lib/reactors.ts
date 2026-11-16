import { supabaseAdmin } from "../supabase";
import { withDirectSql } from "./direct-db";
import { resolveAvatarUrl } from "./avatar";

const LOCK_PREFIX = "locked:";
function isReactionLocked(type: string | null | undefined): boolean {
  return typeof type === "string" && type.startsWith(LOCK_PREFIX);
}
function baseReactionType(type: string | null | undefined): string {
  return isReactionLocked(type) ? (type as string).slice(LOCK_PREFIX.length) : (type ?? "");
}

export type ReactorRow = {
  userId: string;
  name: string;
  username: string | null;
  avatar: string;
  verified: boolean;
  reaction: string;
  type: string;
  createdAt: string | null;
};

export type ReactorsPage = {
  data: ReactorRow[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
};

function encodeCursor(createdAt: string, userId: string): string {
  return `${createdAt}|${userId}`;
}

function parseCursor(raw: string): { createdAt: string; userId: string } | null {
  if (!raw.includes("|")) return null;
  const idx = raw.indexOf("|");
  const createdAt = raw.slice(0, idx).trim();
  const userId = raw.slice(idx + 1).trim();
  if (!createdAt || !userId) return null;
  return { createdAt, userId };
}

/** Newest public reaction per user (locked excluded). */
async function countUniquePublicReactors(
  postId: string,
  blockedSet: Set<string>
): Promise<number> {
  const viaSql = await withDirectSql(async (db) => {
    if (blockedSet.size > 0) {
      const blocked = Array.from(blockedSet);
      const rows = await db`
        SELECT COUNT(*)::int AS n FROM (
          SELECT DISTINCT user_id
          FROM public.reactions
          WHERE post_id = ${postId}::uuid
            AND COALESCE(type, '') NOT LIKE 'locked:%'
            AND NOT (user_id = ANY(${blocked}::uuid[]))
        ) t
      `;
      return Number(rows[0]?.n ?? 0);
    }
    const rows = await db`
      SELECT COUNT(*)::int AS n FROM (
        SELECT DISTINCT user_id
        FROM public.reactions
        WHERE post_id = ${postId}::uuid
          AND COALESCE(type, '') NOT LIKE 'locked:%'
      ) t
    `;
    return Number(rows[0]?.n ?? 0);
  });
  if (typeof viaSql === "number") return viaSql;

  // Fallback: page through PostgREST (default page size can hide rows).
  const unique = new Set<string>();
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from("reactions")
      .select("user_id, type")
      .eq("post_id", postId)
      .range(from, from + pageSize - 1);
    if (error) {
      console.warn("[reactors] count fallback:", error.message);
      break;
    }
    const batch = data ?? [];
    for (const r of batch) {
      const uid = String(r.user_id ?? "");
      if (!uid || blockedSet.has(uid) || isReactionLocked(r.type)) continue;
      unique.add(uid);
    }
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return unique.size;
}

type RawReaction = { user_id: string; type: string | null; created_at: string | null };

async function fetchRawWindow(
  postId: string,
  cursor: { createdAt: string; userId: string } | null,
  fetchSize: number
): Promise<RawReaction[]> {
  const viaSql = await withDirectSql(async (db) => {
    if (cursor) {
      return (await db`
        SELECT user_id, type, created_at
        FROM public.reactions
        WHERE post_id = ${postId}::uuid
          AND (
            created_at < ${cursor.createdAt}::timestamptz
            OR (
              created_at = ${cursor.createdAt}::timestamptz
              AND user_id::text < ${cursor.userId}
            )
          )
        ORDER BY created_at DESC NULLS LAST, user_id DESC
        LIMIT ${fetchSize}
      `) as RawReaction[];
    }
    return (await db`
      SELECT user_id, type, created_at
      FROM public.reactions
      WHERE post_id = ${postId}::uuid
      ORDER BY created_at DESC NULLS LAST, user_id DESC
      LIMIT ${fetchSize}
    `) as RawReaction[];
  });
  if (Array.isArray(viaSql)) {
    return viaSql.map((r) => ({
      user_id: String(r.user_id),
      type: r.type ?? null,
      created_at: r.created_at ? String(r.created_at) : null,
    }));
  }

  // PostgREST fallback — keep scanning with created_at cursor only (less precise).
  let q = supabaseAdmin
    .from("reactions")
    .select("user_id, type, created_at")
    .eq("post_id", postId)
    .order("created_at", { ascending: false })
    .order("user_id", { ascending: false })
    .limit(fetchSize);
  if (cursor?.createdAt) {
    q = q.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},user_id.lt.${cursor.userId})`
    );
  }
  const { data, error } = await q;
  if (error && /created_at|column/i.test(error.message ?? "")) {
    const fallback = await supabaseAdmin
      .from("reactions")
      .select("user_id, type")
      .eq("post_id", postId)
      .limit(fetchSize);
    return (fallback.data ?? []).map((r: any) => ({
      user_id: String(r.user_id),
      type: r.type ?? null,
      created_at: null,
    }));
  }
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    user_id: String(r.user_id),
    type: r.type ?? null,
    created_at: r.created_at ? String(r.created_at) : null,
  }));
}

/**
 * Paginated unique public reactors, newest first.
 * Scans until a full page of unique users is collected or the table ends —
 * does not stop after a single raw window (that was truncating large lists).
 */
export async function listUniquePublicReactors(params: {
  postId: string;
  viewerId: string;
  blockedIds: string[];
  limit: number;
  cursorRaw?: string;
}): Promise<ReactorsPage> {
  const limit = Math.min(Math.max(params.limit, 1), 100);
  const blockedSet = new Set(params.blockedIds);
  const cursor = params.cursorRaw ? parseCursor(params.cursorRaw) : null;

  const uniquePage: RawReaction[] = [];
  const seenUsers = new Set<string>();
  let scanCursor = cursor;
  let exhausted = false;
  // Hard cap on scan windows so a pathological post cannot loop forever.
  for (let window = 0; window < 40 && uniquePage.length < limit + 1; window++) {
    const rows = await fetchRawWindow(params.postId, scanCursor, Math.min(limit * 5, 250));
    if (rows.length === 0) {
      exhausted = true;
      break;
    }
    for (const r of rows) {
      const uid = String(r.user_id ?? "");
      if (!uid || seenUsers.has(uid) || blockedSet.has(uid)) continue;
      if (isReactionLocked(r.type)) continue;
      // Request-cursor skip (DESC keyset): drop rows still on/above the page break.
      if (
        cursor?.createdAt &&
        r.created_at &&
        (r.created_at > cursor.createdAt ||
          (r.created_at === cursor.createdAt && uid >= cursor.userId))
      ) {
        continue;
      }
      seenUsers.add(uid);
      uniquePage.push(r);
      if (uniquePage.length >= limit + 1) break;
    }
    const last = rows[rows.length - 1];
    if (!last?.created_at || !last.user_id) {
      exhausted = true;
      break;
    }
    scanCursor = { createdAt: String(last.created_at), userId: String(last.user_id) };
    if (rows.length < Math.min(limit * 5, 250)) {
      exhausted = true;
      break;
    }
  }

  const hasMore = uniquePage.length > limit;
  const page = hasMore ? uniquePage.slice(0, limit) : uniquePage;

  const profileIds = page.map((r) => r.user_id);
  const byId: Record<string, any> = {};
  if (profileIds.length > 0) {
    let { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, username, avatar_url, gender, is_verified")
      .in("id", profileIds);
    if (error && /is_verified|column/i.test(error.message ?? "")) {
      const fallback = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, username, avatar_url, gender")
        .in("id", profileIds);
      profiles = fallback.data;
    }
    for (const p of profiles ?? []) byId[p.id] = p;
  }

  const data: ReactorRow[] = page.map((r) => {
    const profile = byId[r.user_id];
    const username = String(profile?.username ?? "").trim() || null;
    const fullName = String(profile?.full_name ?? "").trim();
    const name = fullName || username || "Member";
    const reaction = baseReactionType(r.type);
    return {
      userId: r.user_id,
      name,
      username,
      avatar: resolveAvatarUrl(r.user_id, profile?.avatar_url, profile?.gender),
      verified: profile?.is_verified === true,
      reaction,
      type: reaction,
      createdAt: r.created_at,
    };
  });

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last?.created_at && last?.user_id
      ? encodeCursor(String(last.created_at), String(last.user_id))
      : hasMore && !exhausted && last?.user_id
        ? encodeCursor(last.created_at ?? new Date(0).toISOString(), String(last.user_id))
        : null;

  const total = await countUniquePublicReactors(params.postId, blockedSet);

  return {
    data,
    nextCursor,
    hasMore: !!nextCursor,
    total,
  };
}

/**
 * Attach accurate unique public reactor counts onto raw post rows for feed cards.
 * One batched query — does not rely on truncated nested embeds.
 */
export async function attachUniqueReactorCounts(
  posts: any[],
  blockedIds: string[] = []
): Promise<void> {
  const targets: any[] = [];
  for (const p of posts ?? []) {
    if (!p?.id) continue;
    targets.push(p);
    if (p.original?.id) targets.push(p.original);
  }
  const ids = Array.from(new Set(targets.map((p) => String(p.id))));
  if (ids.length === 0) return;

  const blockedSet = new Set(blockedIds);
  const counts = new Map<string, Set<string>>();

  const viaSql = await withDirectSql(async (db) => {
    const rows = await db`
      SELECT post_id, user_id, type
      FROM public.reactions
      WHERE post_id = ANY(${ids}::uuid[])
        AND COALESCE(type, '') NOT LIKE 'locked:%'
    `;
    return rows as { post_id: string; user_id: string; type: string | null }[];
  });

  const rows =
    viaSql ??
    (
      await supabaseAdmin
        .from("reactions")
        .select("post_id, user_id, type")
        .in("post_id", ids)
        .not("type", "like", "locked:%")
        .limit(20000)
    ).data ??
    [];

  for (const r of rows) {
    const pid = String(r.post_id);
    const uid = String(r.user_id);
    if (!pid || !uid || blockedSet.has(uid) || isReactionLocked(r.type)) continue;
    if (!counts.has(pid)) counts.set(pid, new Set());
    counts.get(pid)!.add(uid);
  }

  for (const p of targets) {
    const n = counts.get(String(p.id))?.size;
    if (typeof n === "number") p.unique_reactor_count = n;
  }
}
