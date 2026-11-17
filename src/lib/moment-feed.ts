import { supabaseAdmin } from "../supabase";
import type { TimeCursor } from "./pagination";
import {
  isStrictlyOlderThanCursor,
  normalizeMomentId,
  sortMomentsNewestFirst,
} from "./moment-order";

const META_SELECT = "id, created_at, user_id, audience, type, content, image_url, location";
// Keeps `audience` (privacy-critical) but drops optional display columns.
const META_NO_LOCATION = "id, created_at, user_id, audience, type, content, image_url";
const META_BASIC = "id, created_at, user_id, type";

function orderNewest(query: any): any {
  return query
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false });
}

const SCHEMA_ERROR = /column|audience|schema cache/i;

/**
 * Runs a select with a per-request fallback ladder. Nothing is cached across
 * requests, so one transient schema error can never permanently weaken privacy.
 *
 * If `audience` cannot be read at all, rows are tagged `audience: "private"`
 * (fail closed): callers already hide other users' private moments and still
 * show the viewer's own. Missing audience is never treated as "friends".
 */
async function runSelect(build: (select: string) => any): Promise<any[]> {
  let { data, error } = await build(META_SELECT);
  if (error && SCHEMA_ERROR.test(String(error.message ?? ""))) {
    console.warn("[moments] meta select failed, retrying without location:", error.message);
    ({ data, error } = await build(META_NO_LOCATION));
  }
  if (error && SCHEMA_ERROR.test(String(error.message ?? ""))) {
    console.warn("[moments] audience select failed, failing closed:", error.message);
    ({ data, error } = await build(META_BASIC));
    if (!error) {
      return (data ?? []).map((row: any) => ({ ...row, audience: "private", audience_unknown: true }));
    }
  }
  if (error) throw new Error(error.message);
  return data ?? [];
}
/**
 * Next `batchSize` moments matching `applyFilters`, strictly older than `cursor`,
 * newest first. Ordering is applied on the posts table before the limit.
 * Embeds are intentionally omitted — joining reactions here makes the limit
 * cut joined rows instead of moments.
 */
export async function fetchNewestMomentBatch(
  applyFilters: (query: any) => any,
  cursor: TimeCursor | null,
  batchSize: number
): Promise<any[]> {
  const size = Math.max(1, batchSize);

  const dated = async (narrow: (query: any) => any) =>
    runSelect((select) => orderNewest(narrow(applyFilters(supabaseAdmin.from("posts").select(select)))).limit(size));

  const withUndated = async (datedRows: any[]) => {
    if (datedRows.length >= size) return sortMomentsNewestFirst(datedRows).slice(0, size);
    const undated = await runSelect((select) =>
      applyFilters(supabaseAdmin.from("posts").select(select))
        .is("created_at", null)
        .order("id", { ascending: false })
        .limit(size - datedRows.length)
    );
    return sortMomentsNewestFirst([...datedRows, ...undated]).slice(0, size);
  };

  if (!cursor?.createdAt) {
    return withUndated(await dated((query) => query));
  }

  // The "older" and "same timestamp" probes are independent — run them together.
  const [older, same] = await Promise.all([
    dated((query) => query.lt("created_at", cursor.createdAt)),
    cursor.id
      ? runSelect((select) =>
          applyFilters(supabaseAdmin.from("posts").select(select))
            .eq("created_at", cursor.createdAt)
            .lt("id", normalizeMomentId(cursor.id))
            .order("id", { ascending: false })
            .limit(size)
        )
      : Promise.resolve([] as any[]),
  ]);

  const merged = sortMomentsNewestFirst([...same, ...older])
    .filter((row) => isStrictlyOlderThanCursor(row, cursor))
    .slice(0, size);
  if (merged.length >= size) return merged;
  return withUndated(merged);
}
