import { describe, expect, test } from "bun:test";
import { parseCursor } from "./pagination";
import {
  nextNewestBatch,
  sortMomentsNewestFirst,
  splitKeysetBatch,
  walkNewestPage,
  type MomentKey,
} from "./moment-order";

type Row = MomentKey & { audience?: string; user_id?: string };

function row(id: string, createdAt: string, extra: Partial<Row> = {}): Row {
  return { id, created_at: createdAt, ...extra };
}

function fetcher(rows: Row[]) {
  return async (cursor: { createdAt: string; id: string | null } | null, batchSize: number) =>
    nextNewestBatch(rows, cursor, batchSize);
}

describe("moment order", () => {
  test("sorts newest first and breaks equal timestamps by id", () => {
    const rows = [
      row("a", "2026-01-01T00:00:00.000Z"),
      row("c", "2026-01-03T00:00:00.000Z"),
      row("b", "2026-01-02T00:00:00.000Z"),
      row("m", "2026-01-02T00:00:00.000Z"),
      row("d", "2026-01-02T00:00:00.000Z"),
    ];
    expect(sortMomentsNewestFirst(rows).map((r) => r.id)).toEqual(["c", "m", "d", "b", "a"]);
  });

  test("missing timestamps sort after real moments", () => {
    const rows = [row("new", "2026-05-01T00:00:00.000Z"), row("blank", ""), row("old", "2026-01-01T00:00:00.000Z")];
    expect(sortMomentsNewestFirst(rows).map((r) => r.id)).toEqual(["new", "old", "blank"]);
  });

  test("keyset split matches a full newest-first slice", () => {
    const rows = [
      row("a", "2026-01-01T00:00:00.000Z"),
      row("b", "2026-01-02T00:00:00.000Z"),
      row("c", "2026-01-02T00:00:00.000Z"),
      row("d", "2026-01-02T00:00:00.000Z"),
      row("e", "2026-01-03T00:00:00.000Z"),
    ];
    const first = nextNewestBatch(rows, null, 2);
    const cursor = { createdAt: String(first[1]!.created_at), id: first[1]!.id };
    expect(splitKeysetBatch(rows, cursor, 2).map((r) => r.id)).toEqual(
      nextNewestBatch(rows, cursor, 2).map((r) => r.id)
    );
  });

  test("pages a profile from newest to oldest without gaps or duplicates", async () => {
    const rows = Array.from({ length: 23 }, (_, i) =>
      row(`id-${String(i).padStart(2, "0")}`, new Date(Date.UTC(2026, 0, i + 1)).toISOString())
    );
    const expected = sortMomentsNewestFirst(rows).map((r) => r.id);
    const seen: string[] = [];
    let cursor: { createdAt: string; id: string | null } | null = null;
    for (let page = 0; page < 10; page++) {
      const result = await walkNewestPage({
        cursor,
        limit: 5,
        batchSize: 4,
        fetchFriends: fetcher(rows),
        accept: () => true,
      });
      seen.push(...result.page.map((r) => r.id));
      if (!result.hasMore) break;
      cursor = parseCursor(result.nextCursor);
    }
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(seen.length);
  });

  test("home refresh returns the same first page when nothing new exists", async () => {
    const friends = [
      row("f1", "2026-04-02T00:00:00.000Z", { user_id: "me" }),
      row("f2", "2026-04-01T00:00:00.000Z", { user_id: "friend" }),
    ];
    const publics = [row("p1", "2026-04-03T00:00:00.000Z", { audience: "public", user_id: "stranger" })];
    const load = () =>
      walkNewestPage({
        cursor: null,
        limit: 10,
        batchSize: 2,
        fetchFriends: fetcher(friends),
        fetchPublic: fetcher(publics),
        accept: () => true,
      });
    const first = await load();
    const second = await load();
    expect(first.page.map((r) => r.id)).toEqual(["p1", "f1", "f2"]);
    expect(second.page.map((r) => r.id)).toEqual(first.page.map((r) => r.id));
    expect(first.hasMore).toBe(false);
  });

  test("does not skip a newer friend moment sitting behind a public batch", async () => {
    const friends = [row("friend-new", "2026-06-02T00:00:00.000Z")];
    const publics = Array.from({ length: 6 }, (_, i) =>
      row(`pub-${i}`, new Date(Date.UTC(2026, 5, 10 - i)).toISOString(), { audience: "public" })
    );
    const seen: string[] = [];
    let cursor: { createdAt: string; id: string | null } | null = null;
    for (let page = 0; page < 8; page++) {
      const result = await walkNewestPage({
        cursor,
        limit: 3,
        batchSize: 2,
        fetchFriends: fetcher(friends),
        fetchPublic: fetcher(publics),
        accept: () => true,
      });
      seen.push(...result.page.map((r) => r.id));
      if (!result.hasMore) break;
      cursor = parseCursor(result.nextCursor);
    }
    expect(seen[0]).toBe("pub-0");
    expect(seen).toContain("friend-new");
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(7);
  });

  test("filtered moments do not hide the next visible moment", async () => {
    const rows = [
      row("visible-new", "2026-08-03T00:00:00.000Z", { audience: "friends" }),
      row("hidden", "2026-08-02T00:00:00.000Z", { audience: "private" }),
      row("visible-old", "2026-08-01T00:00:00.000Z", { audience: "friends" }),
    ];
    const result = await walkNewestPage({
      cursor: null,
      limit: 10,
      batchSize: 2,
      fetchFriends: fetcher(rows),
      accept: (r) => r.audience !== "private",
    });
    expect(result.page.map((r) => r.id)).toEqual(["visible-new", "visible-old"]);
    expect(result.page.some((r) => r.id === "hidden")).toBe(false);
  });

  test("equal timestamps stay stable across pages", async () => {
    const stamp = "2026-09-01T12:00:00.000Z";
    const rows = ["aa", "cc", "bb", "dd"].map((id) => row(id, stamp));
    const seen: string[] = [];
    let cursor: { createdAt: string; id: string | null } | null = null;
    for (let page = 0; page < 6; page++) {
      const result = await walkNewestPage({
        cursor,
        limit: 2,
        batchSize: 2,
        fetchFriends: fetcher(rows),
        accept: () => true,
      });
      seen.push(...result.page.map((r) => r.id));
      if (!result.hasMore) break;
      cursor = parseCursor(result.nextCursor);
    }
    expect(seen).toEqual(sortMomentsNewestFirst(rows).map((r) => r.id));
  });
});
