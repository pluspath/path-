/** Shared cursor/limit helpers for feed-style endpoints. */

export function parseLimit(raw: string | undefined, def: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(max, Math.floor(n));
}

export type TimeCursor = { createdAt: string; id: string | null };

/** Parse `created_at|id` or a bare ISO timestamp. */
export function parseCursor(raw: string | undefined | null): TimeCursor | null {
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw).trim();
  const pipe = s.indexOf("|");
  if (pipe >= 0) {
    const createdAt = s.slice(0, pipe).trim();
    const id = s.slice(pipe + 1).trim() || null;
    if (!createdAt) return null;
    return { createdAt, id };
  }
  return { createdAt: s, id: null };
}

export function encodeCursor(createdAt: string, id: string): string {
  return `${createdAt}|${id}`;
}

/** Strictly older than cursor — for newest-first feeds / "load more". */
export function isOlderThanCursor(createdAt: string, id: string, cursor: TimeCursor): boolean {
  const t = new Date(createdAt).getTime();
  const ct = new Date(cursor.createdAt).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(ct)) return false;
  if (t < ct) return true;
  if (t > ct) return false;
  if (cursor.id) return id < cursor.id;
  return false;
}

/** Strictly newer than cursor — for oldest-first / "load newer" pages. */
export function isNewerThanCursor(createdAt: string, id: string, cursor: TimeCursor): boolean {
  const t = new Date(createdAt).getTime();
  const ct = new Date(cursor.createdAt).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(ct)) return false;
  if (t > ct) return true;
  if (t < ct) return false;
  if (cursor.id) return id > cursor.id;
  return false;
}
