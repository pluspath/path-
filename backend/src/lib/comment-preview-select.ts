/**
 * Pure selection rules for the Moment comment preview.
 *
 * Priority:
 * 1. Authenticated viewer's most recent comment on the Moment
 * 2. Otherwise the latest comment overall (excluding blocked authors)
 * 3. None
 *
 * Viewer id must come from the authenticated session — never from the client body.
 */

export type PreviewCommentCandidate = {
  id: string;
  post_id: string;
  user_id: string;
  created_at: string;
};

export function pickCommentPreview<T extends PreviewCommentCandidate>(
  rows: T[],
  viewerId: string,
  blockedIds: Iterable<string> = [],
): T | null {
  if (!viewerId || !rows.length) return null;
  const blocked = blockedIds instanceof Set ? blockedIds : new Set(blockedIds);

  const visible = rows.filter(
    (row) => !!row?.user_id && (row.user_id === viewerId || !blocked.has(row.user_id)),
  );
  if (!visible.length) return null;

  const byNewest = (a: T, b: T) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

  const mine = visible.filter((row) => row.user_id === viewerId).sort(byNewest);
  if (mine[0]) return mine[0];

  return visible.slice().sort(byNewest)[0] ?? null;
}

/** Group rows by post_id, keeping only the newest row per post. */
export function newestPerPost<T extends PreviewCommentCandidate>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  const sorted = rows
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  for (const row of sorted) {
    if (!row?.post_id || map.has(row.post_id)) continue;
    map.set(row.post_id, row);
  }
  return map;
}
