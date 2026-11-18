import { describe, expect, test } from "bun:test";
import { canViewerSeeMoment, type MomentVisibilityContext } from "./moment-visibility";

/**
 * Mirrors the authorization gate used by POST /api/posts repathOf before insert.
 * Keeps the privacy boundary testable without spinning up HTTP.
 */
function canRepathRoot(
  viewerId: string,
  root: { user_id: string; audience?: string | null },
  ctx: MomentVisibilityContext,
): boolean {
  if (root.user_id === viewerId) return false;
  return canViewerSeeMoment(viewerId, root, ctx);
}

function baseCtx(overrides: Partial<MomentVisibilityContext> = {}): MomentVisibilityContext {
  return {
    friendIds: new Set(),
    closeAuthorIds: new Set(),
    blockedIds: new Set(),
    deletionHiddenIds: new Set(),
    ...overrides,
  };
}

describe("repath authorization", () => {
  test("rejects own moments", () => {
    expect(
      canRepathRoot("me", { user_id: "me", audience: "public" }, baseCtx())
    ).toBe(false);
  });

  test("allows public moments from others", () => {
    expect(
      canRepathRoot("me", { user_id: "author", audience: "public" }, baseCtx())
    ).toBe(true);
  });

  test("rejects friends-only moments without friendship", () => {
    expect(
      canRepathRoot("me", { user_id: "author", audience: "friends" }, baseCtx())
    ).toBe(false);
  });

  test("allows friends-only moments for accepted friends", () => {
    expect(
      canRepathRoot(
        "me",
        { user_id: "author", audience: "friends" },
        baseCtx({ friendIds: new Set(["author"]) })
      )
    ).toBe(true);
  });

  test("rejects private moments even for friends", () => {
    expect(
      canRepathRoot(
        "me",
        { user_id: "author", audience: "private" },
        baseCtx({ friendIds: new Set(["author"]) })
      )
    ).toBe(false);
  });

  test("rejects blocked authors", () => {
    expect(
      canRepathRoot(
        "me",
        { user_id: "author", audience: "public" },
        baseCtx({ blockedIds: new Set(["author"]) })
      )
    ).toBe(false);
  });

  test("close audience requires author starred the viewer", () => {
    expect(
      canRepathRoot(
        "me",
        { user_id: "author", audience: "close" },
        baseCtx({ friendIds: new Set(["author"]) })
      )
    ).toBe(false);
    expect(
      canRepathRoot(
        "me",
        { user_id: "author", audience: "close" },
        baseCtx({
          friendIds: new Set(["author"]),
          closeAuthorIds: new Set(["author"]),
        })
      )
    ).toBe(true);
  });
});
