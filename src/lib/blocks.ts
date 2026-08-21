import { supabaseAdmin } from "../supabase";

// Returns the BIDIRECTIONAL block set for `userId`: the distinct ids of every
// other user that is on either side of a block row with this user (rows where
// blocker_id = userId OR blocked_id = userId). For each such row we keep "the
// other user's id" (the one that isn't userId). This is the set the app should
// hide from `userId` in BOTH directions. Returns [] on any error.
export async function getBlockedIds(userId: string, client: any = supabaseAdmin): Promise<string[]> {
  const { data, error } = await client
    .from("blocks")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);

  if (error || !data) return [];

  const others = new Set<string>();
  for (const row of data as Array<{ blocker_id: string; blocked_id: string }>) {
    const otherId = row.blocker_id === userId ? row.blocked_id : row.blocker_id;
    if (otherId && otherId !== userId) others.add(otherId);
  }
  return Array.from(others);
}

// True when there is a block between the two users in EITHER direction.
export async function isBlocked(userId: string, otherId: string, client: any = supabaseAdmin): Promise<boolean> {
  if (!userId || !otherId) return false;
  const { data, error } = await client
    .from("blocks")
    .select("id")
    .or(
      `and(blocker_id.eq.${userId},blocked_id.eq.${otherId}),and(blocker_id.eq.${otherId},blocked_id.eq.${userId})`
    )
    .limit(1)
    .maybeSingle();

  if (error) return false;
  return !!data;
}
