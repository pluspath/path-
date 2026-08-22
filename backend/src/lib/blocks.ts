import { supabaseAdmin, createUserClient } from "../supabase";
import { env } from "../env";

function isMissingRelation(error: any): boolean {
  const msg = String(error?.message ?? "");
  const code = String(error?.code ?? "");
  return (
    code === "42P01" ||
    /does not exist|user_blocks|Could not find the table/i.test(msg)
  );
}

function isDuplicate(error: any): boolean {
  return /duplicate|unique|already exists/i.test(String(error?.message ?? ""));
}

/** Always prefer service role so RLS cannot silently reject moderation writes. */
function writeClient(accessToken?: string | null) {
  if (env.SUPABASE_SERVICE_ROLE_KEY) return supabaseAdmin;
  if (accessToken) return createUserClient(accessToken);
  return supabaseAdmin;
}

export async function getBlockedIds(userId: string, client: any = supabaseAdmin): Promise<string[]> {
  const others = new Set<string>();

  const { data: rows, error } = await client
    .from("user_blocks")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);

  if (!error && rows) {
    for (const row of rows as Array<{ blocker_id: string; blocked_id: string }>) {
      const otherId = row.blocker_id === userId ? row.blocked_id : row.blocker_id;
      if (otherId && otherId !== userId) others.add(otherId);
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
  // Prefer service role; also try user JWT as a second chance.
  const clients = env.SUPABASE_SERVICE_ROLE_KEY
    ? [supabaseAdmin, ...(accessToken ? [createUserClient(accessToken)] : [])]
    : [accessToken ? createUserClient(accessToken) : supabaseAdmin];

  // Remove friendship so they leave each other's friend lists.
  for (const db of clients) {
    await db
      .from("friendships")
      .delete()
      .or(
        `and(requester_id.eq.${blockerId},receiver_id.eq.${blockedId}),and(requester_id.eq.${blockedId},receiver_id.eq.${blockerId})`
      );
  }

  let lastError = "";

  for (const db of clients) {
    // Prefer plain insert — upsert onConflict names differ across environments.
    const { error: insertError } = await db
      .from("user_blocks")
      .insert({ blocker_id: blockerId, blocked_id: blockedId });

    if (!insertError || isDuplicate(insertError)) return { ok: true };

    if (!isMissingRelation(insertError)) {
      lastError = insertError.message;
      console.error("[blocks] user_blocks insert failed:", insertError.message, insertError.code);
    }

    // Friendship fallback encodes the block when user_blocks is unavailable.
    const { error: friendError } = await db.from("friendships").insert({
      requester_id: blockerId,
      receiver_id: blockedId,
      status: "blocked",
    });

    if (!friendError || isDuplicate(friendError)) return { ok: true };
    lastError = friendError.message;
    console.error("[blocks] friendship fallback failed:", friendError.message);
  }

  return { ok: false, message: lastError || "Failed to block user" };
}

export async function removeBlock(
  blockerId: string,
  blockedId: string,
  accessToken?: string | null
): Promise<{ ok: true } | { ok: false; message: string }> {
  const db = writeClient(accessToken);

  const { error } = await db
    .from("user_blocks")
    .delete()
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId);

  if (error && !isMissingRelation(error)) {
    console.error("[blocks] user_blocks delete failed:", error.message);
    return { ok: false, message: error.message };
  }

  await db
    .from("friendships")
    .delete()
    .eq("status", "blocked")
    .or(
      `and(requester_id.eq.${blockerId},receiver_id.eq.${blockedId}),and(requester_id.eq.${blockedId},receiver_id.eq.${blockerId})`
    );

  return { ok: true };
}

export async function listBlockedProfiles(
  userId: string,
  accessToken?: string | null
): Promise<Array<{ id: string; username: string; name: string; avatar: string }>> {
  const db = writeClient(accessToken);
  const blockedIds: string[] = [];

  const { data: rows, error } = await db
    .from("user_blocks")
    .select("blocked_id, created_at")
    .eq("blocker_id", userId)
    .order("created_at", { ascending: false });

  if (!error && rows) {
    for (const r of rows) {
      if (r.blocked_id) blockedIds.push(r.blocked_id);
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
