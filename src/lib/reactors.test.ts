import { describe, expect, test } from "bun:test";

/** Mirror of keyset "still on/above cursor" skip used in listUniquePublicReactors. */
function shouldSkipForCursor(
  row: { created_at: string; user_id: string },
  cursor: { createdAt: string; userId: string } | null
): boolean {
  if (!cursor) return false;
  if (row.created_at > cursor.createdAt) return true;
  if (row.created_at === cursor.createdAt && row.user_id >= cursor.userId) return true;
  return false;
}

describe("reactors cursor keyset", () => {
  test("skips rows newer or equal to cursor in DESC order", () => {
    const cursor = { createdAt: "2026-01-02T00:00:00.000Z", userId: "u5" };
    expect(
      shouldSkipForCursor({ created_at: "2026-01-03T00:00:00.000Z", user_id: "u1" }, cursor)
    ).toBe(true);
    expect(
      shouldSkipForCursor({ created_at: "2026-01-02T00:00:00.000Z", user_id: "u9" }, cursor)
    ).toBe(true);
    expect(
      shouldSkipForCursor({ created_at: "2026-01-02T00:00:00.000Z", user_id: "u5" }, cursor)
    ).toBe(true);
    expect(
      shouldSkipForCursor({ created_at: "2026-01-02T00:00:00.000Z", user_id: "u4" }, cursor)
    ).toBe(false);
    expect(
      shouldSkipForCursor({ created_at: "2026-01-01T00:00:00.000Z", user_id: "u9" }, cursor)
    ).toBe(false);
  });
});

describe("unique reactor math", () => {
  test("18 users with 5 visible leaves 13 others", () => {
    const total = 18;
    const visible = 5;
    expect(Math.max(0, total - visible)).toBe(13);
  });

  test("100 users paginated at 40 needs 3 pages", () => {
    const total = 100;
    const page = 40;
    const pages = Math.ceil(total / page);
    expect(pages).toBe(3);
    let loaded = 0;
    let hasMore = true;
    let n = 0;
    while (hasMore) {
      n++;
      const batch = Math.min(page, total - loaded);
      loaded += batch;
      hasMore = loaded < total;
    }
    expect(n).toBe(3);
    expect(loaded).toBe(100);
  });
});
