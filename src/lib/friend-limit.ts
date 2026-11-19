/** Strict accepted-friends cap for Path+. Pending / rejected / blocked do not count. */
export const MAX_ACCEPTED_FRIENDS = 150;

export const FRIEND_LIMIT_CODE = "FRIEND_LIMIT";

export function friendLimitMessage(limit: number = MAX_ACCEPTED_FRIENDS): string {
  return `You've reached the maximum of ${limit} friends. Remove a friend before adding another.`;
}

/** True when accepting one more friendship would exceed the cap. */
export function wouldExceedFriendLimit(
  currentAcceptedCount: number,
  limit: number = MAX_ACCEPTED_FRIENDS
): boolean {
  return currentAcceptedCount >= limit;
}

/**
 * Given ranked accepted friendships (newest first), return the friendship ids
 * that must be removed so the user keeps exactly `limit` newest rows.
 */
export function selectOldestExcessFriendshipIds(
  newestFirst: Array<{ friendshipId: string }>,
  limit: number = MAX_ACCEPTED_FRIENDS
): string[] {
  if (newestFirst.length <= limit) return [];
  return newestFirst.slice(limit).map((row) => row.friendshipId);
}

/**
 * Deterministic iterative cleanup plan:
 * process over-limit users by (friendCount DESC, userId ASC); for each, remove
 * only their current oldest excess among friendships not already marked.
 */
export function planFriendLimitCleanup(
  edges: Array<{ userId: string; friendshipId: string; establishedAt: string }>,
  limit: number = MAX_ACCEPTED_FRIENDS
): { removeIds: string[]; affectedUserIds: string[] } {
  const byUser = new Map<string, Array<{ friendshipId: string; establishedAt: string }>>();
  for (const edge of edges) {
    const list = byUser.get(edge.userId) ?? [];
    list.push({ friendshipId: edge.friendshipId, establishedAt: edge.establishedAt });
    byUser.set(edge.userId, list);
  }

  const removed = new Set<string>();
  const affected = new Set<string>();

  const countFor = (userId: string): number => {
    const list = byUser.get(userId) ?? [];
    return list.filter((e) => !removed.has(e.friendshipId)).length;
  };

  // Stable iteration until no user is over the limit.
  for (let guard = 0; guard < 10_000; guard++) {
    const over = Array.from(byUser.keys())
      .map((userId) => ({ userId, friendCount: countFor(userId) }))
      .filter((u) => u.friendCount > limit)
      .sort((a, b) => b.friendCount - a.friendCount || a.userId.localeCompare(b.userId));

    if (over.length === 0) break;

    const target = over[0]!;
    const excess = target.friendCount - limit;
    const remaining = (byUser.get(target.userId) ?? [])
      .filter((e) => !removed.has(e.friendshipId))
      // Oldest first → remove these; newest stay.
      .sort(
        (a, b) =>
          a.establishedAt.localeCompare(b.establishedAt) ||
          a.friendshipId.localeCompare(b.friendshipId)
      );

    let removedThisUser = 0;
    for (const edge of remaining) {
      if (removedThisUser >= excess) break;
      if (removed.has(edge.friendshipId)) continue;
      removed.add(edge.friendshipId);
      removedThisUser += 1;
    }

    if (removedThisUser === 0) break;
    affected.add(target.userId);
  }

  return {
    removeIds: Array.from(removed).sort(),
    affectedUserIds: Array.from(affected).sort(),
  };
}
