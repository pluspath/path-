import { describe, expect, test } from "bun:test";
import {
  MAX_ACCEPTED_FRIENDS,
  friendLimitMessage,
  planFriendLimitCleanup,
  selectOldestExcessFriendshipIds,
  wouldExceedFriendLimit,
} from "./friend-limit";

describe("friend limit helpers", () => {
  test("149 accepted can reach 150", () => {
    expect(wouldExceedFriendLimit(149)).toBe(false);
    expect(wouldExceedFriendLimit(150)).toBe(true);
    expect(wouldExceedFriendLimit(151)).toBe(true);
  });

  test("message mentions the 150 cap", () => {
    expect(friendLimitMessage()).toContain(String(MAX_ACCEPTED_FRIENDS));
  });

  test("selectOldestExcessFriendshipIds keeps newest 150", () => {
    const newestFirst = Array.from({ length: 155 }, (_, i) => ({
      friendshipId: `f-${String(i).padStart(3, "0")}`,
    }));
    const remove = selectOldestExcessFriendshipIds(newestFirst, 150);
    expect(remove).toHaveLength(5);
    expect(remove).toEqual(["f-150", "f-151", "f-152", "f-153", "f-154"]);
  });

  test("pending-style edges are irrelevant — only provided accepted edges count", () => {
    // Caller supplies accepted-only edges; empty pending set removes nothing.
    const plan = planFriendLimitCleanup(
      Array.from({ length: 149 }, (_, i) => ({
        userId: "u1",
        friendshipId: `a-${i}`,
        establishedAt: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      })),
      150
    );
    expect(plan.removeIds).toEqual([]);
    expect(plan.affectedUserIds).toEqual([]);
  });

  test("cleanup retains newest 150 and removes oldest excess", () => {
    const edges = Array.from({ length: 155 }, (_, i) => ({
      userId: "u1",
      friendshipId: `f-${String(i).padStart(3, "0")}`,
      // higher i = newer
      establishedAt: `2026-01-01T00:${String(i).padStart(2, "0")}:00Z`,
    }));
    const plan = planFriendLimitCleanup(edges, 150);
    expect(plan.affectedUserIds).toEqual(["u1"]);
    expect(plan.removeIds).toEqual(["f-000", "f-001", "f-002", "f-003", "f-004"]);
  });

  test("mutual over-limit users do not remove more than necessary", () => {
    // Shared newest friendships + private oldest excess for each user.
    const shared = Array.from({ length: 150 }, (_, i) => ({
      friendshipId: `shared-${String(i).padStart(3, "0")}`,
      establishedAt: `2026-06-01T00:${String(i % 60).padStart(2, "0")}:00Z`,
    }));
    const edges: Array<{ userId: string; friendshipId: string; establishedAt: string }> = [];
    for (const s of shared) {
      edges.push({ userId: "a", ...s });
      edges.push({ userId: "b", ...s });
    }
    // A has 5 older private friends → 155
    for (let i = 0; i < 5; i++) {
      edges.push({
        userId: "a",
        friendshipId: `a-old-${i}`,
        establishedAt: `2020-01-0${i + 1}T00:00:00Z`,
      });
    }
    // B has 2 older private friends → 152
    for (let i = 0; i < 2; i++) {
      edges.push({
        userId: "b",
        friendshipId: `b-old-${i}`,
        establishedAt: `2020-02-0${i + 1}T00:00:00Z`,
      });
    }

    const plan = planFriendLimitCleanup(edges, 150);
    expect(plan.removeIds).toEqual([
      "a-old-0",
      "a-old-1",
      "a-old-2",
      "a-old-3",
      "a-old-4",
      "b-old-0",
      "b-old-1",
    ]);
    // After removals both users have exactly 150 (shared set).
    const remaining = new Set(
      edges.map((e) => e.friendshipId).filter((id) => !plan.removeIds.includes(id))
    );
    const countA = edges.filter((e) => e.userId === "a" && remaining.has(e.friendshipId)).length;
    const countB = edges.filter((e) => e.userId === "b" && remaining.has(e.friendshipId)).length;
    expect(countA).toBe(150);
    expect(countB).toBe(150);
  });
});
