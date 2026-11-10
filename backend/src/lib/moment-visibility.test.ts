import { describe, expect, test } from "bun:test";
import { canViewerSeeMoment, normalizeAudience, type MomentVisibilityContext } from "./moment-visibility";

const emptyCtx = (): MomentVisibilityContext => ({
  friendIds: new Set(),
  closeAuthorIds: new Set(),
  blockedIds: new Set(),
  deletionHiddenIds: new Set(),
});

describe("normalizeAudience", () => {
  test("defaults missing to friends", () => {
    expect(normalizeAudience(undefined)).toBe("friends");
    expect(normalizeAudience(null)).toBe("friends");
    expect(normalizeAudience("nope")).toBe("friends");
  });
});

describe("canViewerSeeMoment", () => {
  test("owner always sees own moments", () => {
    const ctx = emptyCtx();
    expect(canViewerSeeMoment("me", { user_id: "me", audience: "private" }, ctx)).toBe(true);
  });

  test("public visible to non-friend (private profile unrelated)", () => {
    const ctx = emptyCtx();
    expect(canViewerSeeMoment("viewer", { user_id: "author", audience: "public" }, ctx)).toBe(true);
  });

  test("friends-only hidden from non-friend", () => {
    const ctx = emptyCtx();
    expect(canViewerSeeMoment("viewer", { user_id: "author", audience: "friends" }, ctx)).toBe(false);
  });

  test("friends-only visible to friend", () => {
    const ctx = emptyCtx();
    ctx.friendIds.add("author");
    expect(canViewerSeeMoment("viewer", { user_id: "author", audience: "friends" }, ctx)).toBe(true);
  });

  test("close only for starred viewer", () => {
    const ctx = emptyCtx();
    ctx.friendIds.add("author");
    expect(canViewerSeeMoment("viewer", { user_id: "author", audience: "close" }, ctx)).toBe(false);
    ctx.closeAuthorIds.add("author");
    expect(canViewerSeeMoment("viewer", { user_id: "author", audience: "close" }, ctx)).toBe(true);
  });

  test("private hidden from everyone else", () => {
    const ctx = emptyCtx();
    ctx.friendIds.add("author");
    expect(canViewerSeeMoment("viewer", { user_id: "author", audience: "private" }, ctx)).toBe(false);
  });

  test("blocked author hidden even for public", () => {
    const ctx = emptyCtx();
    ctx.blockedIds.add("author");
    expect(canViewerSeeMoment("viewer", { user_id: "author", audience: "public" }, ctx)).toBe(false);
  });
});
