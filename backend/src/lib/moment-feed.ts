import { supabaseAdmin } from "../supabase";
import type { TimeCursor } from "./pagination";
import {
  isStrictlyOlderThanCursor,
  normalizeMomentId,
  sortMomentsNewestFirst,
} from "./moment-order";

const META_SELECT = "id, created_at, user_id, audience, type, content, image_url, location";
const META_BASIC = "id, created_at, user_id, type";

let metaSelect = META_SELECT;

function orderNewest(query: any): any {
  return query
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false });
}

async function runSelect(build: () => any): Promise<any[]> {
  let { data, error } = await build();
  if (
    error &&
    metaSelect !== META_BASIC &&
    /column|audience|schema cache/i.test(String(error.message ?? ""))
  ) {
    console.warn("[moments] meta select failed, retrying without optional columns:", error.message);
    metaSelect = META_BASIC;
    ({ data, error } = await build());
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
  const select = () => metaSelect;

  const dated = async (narrow: (query: any) => any) =>
    runSelect(() => orderNewest(narrow(applyFilters(supabaseAdmin.from("posts").select(select())))).limit(size));

  const withUndated = async (datedRows: any[]) => {
    if (datedRows.length >= size) return sortMomentsNewestFirst(datedRows).slice(0, size);
    const undated = await runSelect(() =>
      applyFilters(supabaseAdmin.from("posts").select(select()))
        .is("created_at", null)
        .order("id", { ascending: false })
        .limit(size - datedRows.length)
    );
    return sortMomentsNewestFirst([...datedRows, ...undated]).slice(0, size);
  };

  if (!cursor?.createdAt) {
    return withUndated(await dated((query) => query));
  }

  const older = await dated((query) => query.lt("created_at", cursor.createdAt));
  let same: any[] = [];
  if (cursor.id) {
    same = await runSelect(() =>
      applyFilters(supabaseAdmin.from("posts").select(select()))
        .eq("created_at", cursor.createdAt)
        .lt("id", normalizeMomentId(cursor.id))
        .order("id", { ascending: false })
        .limit(size)
    );
  }

  const merged = sortMomentsNewestFirst([...same, ...older])
    .filter((row) => isStrictlyOlderThanCursor(row, cursor))
    .slice(0, size);
  if (merged.length >= size) return merged;
  return withUndated(merged);
}
