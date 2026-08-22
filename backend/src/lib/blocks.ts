import { supabaseAdmin, createUserClient } from "../supabase";
import { env } from "../env";

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
  const others = new Set<string>();

  for (const table of ["user_blocks", "blocks"] as const) {
    const queries = [
      client.from(table).select("*").eq("blocker_id", userId),
      client.from(table).select("*").eq("blocked_id", userId),
      client.from(table).select("*").eq("user_id", userId),
      client.from(table).select("*").eq("blocked_user_id", userId),
    ];
    for (const q of queries) {
      const { data: rows, error } = await q;
      if (error || !rows) continue;
      for (const row of rows) {
        const blocker = row.blocker_id ?? row.user_id ?? row.blocker;
        const blocked = row.blocked_id ?? row.blocked_user_id ?? row.blocked;
        if (blocker === userId && blocked && blocked !== userId) others.add(blocked);
        if (blocked === userId && blocker && blocker !== userId) others.add(blocker);
      }
    }
  }

  const { data: friendshipBlocks } = await client
    .from("friendships")
    .select("requester_id, receiver_id, status")
    .eq("status", "blocked")
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);

  for (const row of friendshipBlocks ?? []) {
    const otherId = row.requester_id === userId ? row.receiver_id : row.requester_id;
    if (otherId && otherId !== userId) others.add(otherId);
  }

  return Array.from(others);
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
    if (inserted.ok) return { ok: true };
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
    .select("id, username, full_name, avatar_url")
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
      avatar: p.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.id}`,
    }));
}
