import { supabaseAdmin, createUserClient } from "../supabase";
import { env } from "../env";
import { resolveAvatarUrl } from "./avatar";

function isMissingRelation(error: any): boolean {
  const msg = String(error?.message ?? "");
  const code = String(error?.code ?? "");
  return (
    code === "42P01" ||
    /does not exist|Could not find the table|relation/i.test(msg)
  );
}

function isDuplicate(error: any): boolean {
  return /duplicate|unique|already exists/i.test(String(error?.message ?? ""));
}

function isColumnError(error: any): boolean {
  return /column|schema cache|Could not find/i.test(String(error?.message ?? ""));
}

/** Always prefer service role so RLS cannot silently reject moderation writes. */
function writeClient(accessToken?: string | null) {
  if (env.SUPABASE_SERVICE_ROLE_KEY) return supabaseAdmin;
  if (accessToken) return createUserClient(accessToken);
  return supabaseAdmin;
}

function clientsFor(accessToken?: string | null) {
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    return [supabaseAdmin, ...(accessToken ? [createUserClient(accessToken)] : [])];
  }
  return [accessToken ? createUserClient(accessToken) : supabaseAdmin];
}

const BLOCK_CACHE_TTL_MS = 30_000;
const blockIdCache = new Map<string, { ids: string[]; expires: number }>();

/** Persist a block row. Tries common table/column shapes used across environments. */
async function insertBlockRow(
  db: any,
  blockerId: string,
  blockedId: string
): Promise<{ ok: true } | { ok: false; message: string; missingTable?: boolean }> {
  const attempts: Array<{ table: string; row: Record<string, string> }> = [
    { table: "user_blocks", row: { blocker_id: blockerId, blocked_id: blockedId } },
    { table: "blocks", row: { blocker_id: blockerId, blocked_id: blockedId } },
    { table: "user_blocks", row: { user_id: blockerId, blocked_user_id: blockedId } },
    { table: "blocks", row: { user_id: blockerId, blocked_user_id: blockedId } },
    { table: "user_blocks", row: { blocker: blockerId, blocked: blockedId } },
  ];

  let lastError = "";
  let missingTable = false;

  for (const attempt of attempts) {
    const { error } = await db.from(attempt.table).insert(attempt.row);
    if (!error || isDuplicate(error)) return { ok: true };
    if (isMissingRelation(error)) {
      missingTable = true;
      lastError = error.message;
      continue;
    }
    if (isColumnError(error)) {
      lastError = error.message;
      continue;
    }
    lastError = error.message;
    console.error(`[blocks] insert ${attempt.table} failed:`, error.message, error.code);
  }

  return { ok: false, message: lastError || "Failed to insert block", missingTable };
}

/**
 * Encode a block on the friendships row WITHOUT deleting first.
 * Prefer UPDATE existing row → status=blocked; else INSERT.
 */
async function encodeBlockOnFriendship(
  db: any,
  blockerId: string,
  blockedId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: existing } = await db
    .from("friendships")
    .select("id, requester_id, receiver_id, status")
    .or(
      `and(requester_id.eq.${blockerId},receiver_id.eq.${blockedId}),and(requester_id.eq.${blockedId},receiver_id.eq.${blockerId})`
    )
    .maybeSingle();

  if (existing?.id) {
    const { error } = await db
      .from("friendships")
      .update({ status: "blocked", requester_id: blockerId, receiver_id: blockedId })
      .eq("id", existing.id);
    if (!error) return { ok: true };
    // If status enum rejects "blocked", fall through to insert attempt messaging.
    console.error("[blocks] friendship status update failed:", error.message);
    return { ok: false, message: error.message };
  }

  const { error: insertError } = await db.from("friendships").insert({
    requester_id: blockerId,
    receiver_id: blockedId,
    status: "blocked",
  });

  if (!insertError || isDuplicate(insertError)) return { ok: true };
  return { ok: false, message: insertError.message };
}

/** After a real block row exists, drop normal friend/pending links. */
async function clearNormalFriendship(
  db: any,
  blockerId: string,
  blockedId: string
): Promise<void> {
  // Only remove pending/accepted — never wipe a status=blocked friendship row.
  await db
    .from("friendships")
    .delete()
    .in("status", ["pending", "accepted"])
    .or(
      `and(requester_id.eq.${blockerId},receiver_id.eq.${blockedId}),and(requester_id.eq.${blockedId},receiver_id.eq.${blockerId})`
    );
}

export async function getBlockedIds(userId: string, client: any = supabaseAdmin): Promise<string[]> {
  const cached = blockIdCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.ids;

  const others = new Set<string>();

  const tableQueries: Promise<{ data: any[] | null; error: any }>[] = [];
  for (const table of ["user_blocks", "blocks"] as const) {
    tableQueries.push(
      client.from(table).select("*").eq("blocker_id", userId),
      client.from(table).select("*").eq("blocked_id", userId),
      client.from(table).select("*").eq("user_id", userId),
      client.from(table).select("*").eq("blocked_user_id", userId)
    );
  }
  tableQueries.push(
    client
      .from("friendships")
      .select("requester_id, receiver_id, status")
      .eq("status", "blocked")
      .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`)
  );

  const results = await Promise.all(tableQueries);

  for (let i = 0; i < results.length - 1; i++) {
    const { data: rows, error } = results[i];
    if (error || !rows) continue;
    for (const row of rows) {
      const blocker = row.blocker_id ?? row.user_id ?? row.blocker;
      const blocked = row.blocked_id ?? row.blocked_user_id ?? row.blocked;
      if (blocker === userId && blocked && blocked !== userId) others.add(blocked);
      if (blocked === userId && blocker && blocker !== userId) others.add(blocker);
    }
  }

  const friendshipBlocks = results[results.length - 1]?.data;
  for (const row of friendshipBlocks ?? []) {
    const otherId = row.requester_id === userId ? row.receiver_id : row.requester_id;
    if (otherId && otherId !== userId) others.add(otherId);
  }

  const ids = Array.from(others);
  blockIdCache.set(userId, { ids, expires: Date.now() + BLOCK_CACHE_TTL_MS });
  return ids;
}

/** Drop cached block list after create/remove so the next read is fresh. */
export function invalidateBlockedIdsCache(userId?: string): void {
  if (userId) blockIdCache.delete(userId);
  else blockIdCache.clear();
}

export async function isBlocked(
  userId: string,
  otherId: string,
  client: any = supabaseAdmin
): Promise<boolean> {
  if (!userId || !otherId) return false;
  const ids = await getBlockedIds(userId, client);
  return ids.includes(otherId);
}

export async function createBlock(
  blockerId: string,
  blockedId: string,
  accessToken?: string | null
): Promise<{ ok: true } | { ok: false; message: string }> {
  const clients = clientsFor(accessToken);
  let lastError = "";

  // Keep friendship intact. Block only adds a block row; unblock removes it
  // and the friendship returns to whatever it was (usually still accepted).
  for (const db of clients) {
    const inserted = await insertBlockRow(db, blockerId, blockedId);
    if (inserted.ok) {
      invalidateBlockedIdsCache(blockerId);
      invalidateBlockedIdsCache(blockedId);
      return { ok: true };
    }
    lastError = inserted.message;
  }

  console.error("[blocks] createBlock failed:", lastError);
  return { ok: false, message: lastError || "Failed to block user" };
}

export async function removeBlock(
  blockerId: string,
  blockedId: string,
  accessToken?: string | null
): Promise<{ ok: true } | { ok: false; message: string }> {
  const db = writeClient(accessToken);

  for (const table of ["user_blocks", "blocks"] as const) {
    await db.from(table).delete().eq("blocker_id", blockerId).eq("blocked_id", blockedId);
    await db.from(table).delete().eq("user_id", blockerId).eq("blocked_user_id", blockedId);
  }

  // Do NOT touch friendships — friends stay friends after unblock.
  invalidateBlockedIdsCache(blockerId);
  invalidateBlockedIdsCache(blockedId);
  return { ok: true };
}

export async function listBlockedProfiles(
  userId: string,
  accessToken?: string | null
): Promise<Array<{ id: string; username: string; name: string; avatar: string }>> {
  const db = writeClient(accessToken);
  const blockedIds: string[] = [];

  for (const table of ["user_blocks", "blocks"] as const) {
    let { data: rows, error } = await db
      .from(table)
      .select("*")
      .eq("blocker_id", userId);
    if (error || !rows) {
      ({ data: rows, error } = await db.from(table).select("*").eq("user_id", userId));
    }
    if (error || !rows) continue;
    for (const r of rows) {
      const blocked = r.blocked_id ?? r.blocked_user_id ?? r.blocked;
      if (blocked && !blockedIds.includes(blocked)) blockedIds.push(blocked);
    }
  }

  const { data: friendRows } = await db
    .from("friendships")
    .select("receiver_id, created_at")
    .eq("status", "blocked")
    .eq("requester_id", userId)
    .order("created_at", { ascending: false });

  for (const r of friendRows ?? []) {
    if (r.receiver_id && !blockedIds.includes(r.receiver_id)) {
      blockedIds.push(r.receiver_id);
    }
  }

  if (blockedIds.length === 0) return [];

  const { data: profiles } = await db
    .from("profiles")
    .select("id, username, full_name, avatar_url, gender")
    .in("id", blockedIds);

  const byId: Record<string, any> = {};
  for (const p of profiles ?? []) byId[p.id] = p;

  return blockedIds
    .map((id) => byId[id])
    .filter(Boolean)
    .map((p: any) => ({
      id: p.id,
      username: p.username ?? "",
      name: p.full_name ?? "",
      avatar: resolveAvatarUrl(p.id, p.avatar_url, p.gender),
    }));
}
