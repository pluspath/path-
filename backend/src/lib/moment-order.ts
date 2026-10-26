import { encodeCursor, type TimeCursor } from "./pagination";

/** A moment row that can be ordered by creation time, then id. */
export type MomentKey = {
  id: string;
  created_at?: string | null;
};

const MAX_BATCHES = 15;

export function normalizeMomentId(id: string | null | undefined): string {
  return String(id ?? "").trim().toLowerCase();
}

/** Invalid or missing timestamps sort last (oldest), never ahead of real moments. */
export function momentTimeMs(value: string | null | undefined): number {
  const t = new Date(String(value ?? "")).getTime();
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/**
 * Newest first. Equal timestamps use id descending so the order matches
 * `id < cursor` (a smaller id is older) and stays the same on every request.
 */
export function compareMomentsNewestFirst(a: MomentKey, b: MomentKey): number {
  const dt = momentTimeMs(b.created_at) - momentTimeMs(a.created_at);
  if (dt !== 0) return dt;
  const ia = normalizeMomentId(a.id);
  const ib = normalizeMomentId(b.id);
  if (ia === ib) return 0;
  return ia < ib ? 1 : -1;
}

export function sortMomentsNewestFirst<T extends MomentKey>(rows: T[]): T[] {
  return [...rows].sort(compareMomentsNewestFirst);
}

export function isStrictlyOlderThanCursor(row: MomentKey, cursor: TimeCursor | null): boolean {
  if (!cursor?.createdAt) return true;
  return (
    compareMomentsNewestFirst(row, {
      id: cursor.id ?? "",
      created_at: cursor.createdAt,
    }) > 0
  );
}

/** Next page of an already-loaded newest-first set. Used to prove the keyset. */
export function nextNewestBatch<T extends MomentKey>(
  rows: T[],
  cursor: TimeCursor | null,
  batchSize: number
): T[] {
  const sorted = sortMomentsNewestFirst(rows);
  const older = cursor ? sorted.filter((row) => isStrictlyOlderThanCursor(row, cursor)) : sorted;
  return older.slice(0, Math.max(0, batchSize));
}

/**
 * Same split the database keyset uses: same timestamp with a smaller id, then
 * older timestamps. Must match `nextNewestBatch`.
 */
export function splitKeysetBatch<T extends MomentKey>(
  rows: T[],
  cursor: TimeCursor,
  batchSize: number
): T[] {
  const cursorId = normalizeMomentId(cursor.id);
  const cursorMs = momentTimeMs(cursor.createdAt);
  const same = sortMomentsNewestFirst(
    rows.filter(
      (row) =>
        momentTimeMs(row.created_at) === cursorMs &&
        cursorMs !== Number.NEGATIVE_INFINITY &&
        !!cursorId &&
        normalizeMomentId(row.id) < cursorId
    )
  ).slice(0, batchSize);
  const older = sortMomentsNewestFirst(
    rows.filter((row) => momentTimeMs(row.created_at) < cursorMs)
  ).slice(0, batchSize);
  return sortMomentsNewestFirst([...same, ...older])
    .filter((row) => isStrictlyOlderThanCursor(row, cursor))
    .slice(0, batchSize);
}

function dedupeNewest<T extends MomentKey>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of sortMomentsNewestFirst(rows)) {
    const id = normalizeMomentId(row.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

/**
 * Walk friend and public streams in lockstep.
 * A row is emitted only when every stream that still has more rows has already
 * covered it, so a short page from one query cannot hide a newer row from the other.
 */
export async function walkNewestPage<T extends MomentKey>(options: {
  cursor: TimeCursor | null;
  limit: number;
  batchSize: number;
  fetchFriends: (cursor: TimeCursor | null, batchSize: number) => Promise<T[]>;
  fetchPublic?: (cursor: TimeCursor | null, batchSize: number) => Promise<T[]>;
  accept: (row: T) => boolean;
}): Promise<{ page: T[]; hasMore: boolean; nextCursor: string | null }> {
  const limit = Math.max(0, options.limit);
  const batchSize = Math.max(1, options.batchSize);
  const fetchPublic = options.fetchPublic ?? (async () => []);
  const accepted: T[] = [];
  const seen = new Set<string>();
  let walk = options.cursor;
  let exhausted = false;

  for (let batch = 0; batch < MAX_BATCHES && accepted.length <= limit && !exhausted; batch++) {
    const [friendRows, publicRows] = await Promise.all([
      options.fetchFriends(walk, batchSize),
      fetchPublic(walk, batchSize),
    ]);
    const friends = dedupeNewest(friendRows);
    const publics = dedupeNewest(publicRows);
    const friendExhausted = friends.length < batchSize;
    const publicExhausted = publics.length < batchSize;
    const merged = dedupeNewest([...friends, ...publics]).filter((row) =>
      isStrictlyOlderThanCursor(row, walk)
    );

    const tails: MomentKey[] = [];
    if (!friendExhausted && friends.length > 0) tails.push(friends[friends.length - 1]!);
    if (!publicExhausted && publics.length > 0) tails.push(publics[publics.length - 1]!);

    let consumedOldest: T | null = null;
    for (const row of merged) {
      const pastUnfetched = tails.some((tail) => compareMomentsNewestFirst(row, tail) > 0);
      if (pastUnfetched) break;
      consumedOldest = row;
      const id = normalizeMomentId(row.id);
      if (!id || seen.has(id) || !options.accept(row)) continue;
      seen.add(id);
      accepted.push(row);
      if (accepted.length > limit) break;
    }

    if (accepted.length > limit) break;
    if (friendExhausted && publicExhausted) {
      exhausted = true;
      break;
    }
    if (
      !consumedOldest?.created_at ||
      momentTimeMs(consumedOldest.created_at) === Number.NEGATIVE_INFINITY
    ) {
      exhausted = true;
      break;
    }
    const nextWalk: TimeCursor = {
      createdAt: String(consumedOldest.created_at),
      id: normalizeMomentId(consumedOldest.id) || null,
    };
    if (
      walk &&
      walk.createdAt === nextWalk.createdAt &&
      normalizeMomentId(walk.id) === normalizeMomentId(nextWalk.id)
    ) {
      exhausted = true;
      break;
    }
    walk = nextWalk;
  }

  const stoppedEarly = !exhausted && accepted.length <= limit;
  const hasMore = accepted.length > limit || stoppedEarly;
  const page = accepted.slice(0, limit);
  const anchor = page[page.length - 1];
  const nextCursor =
    hasMore && anchor?.created_at && anchor.id && momentTimeMs(anchor.created_at) !== Number.NEGATIVE_INFINITY
      ? encodeCursor(String(anchor.created_at), normalizeMomentId(anchor.id))
      : hasMore && walk?.createdAt
        ? encodeCursor(walk.createdAt, normalizeMomentId(walk.id) || "00000000-0000-0000-0000-000000000000")
        : null;

  return { page, hasMore: hasMore && !!nextCursor, nextCursor };
}
