import { describe, expect, test } from "bun:test";
import { canViewerSeeMoment, normalizeAudience, type MomentVisibilityContext } from "./moment-visibility";

function ctx(partial: Partial<MomentVisibilityContext> = {}): MomentVisibilityContext {
  return {
    friendIds: new Set(),
    closeAuthorIds: new Set(),
    blockedIds: new Set(),
    deletionHiddenIds: new Set(),
    ...partial,
  };
}

/** Mirrors GET /api/posts?mode=private accept rules (non-base checks). */
function acceptPrivate(
  viewerId: string,
  post: { user_id: string; audience?: string | null },
  visibility: MomentVisibilityContext,
): boolean {
  const audience = normalizeAudience(post.audience);
  if (audience === "public") return false;
  if (post.user_id === viewerId) {
    return audience === "friends" || audience === "close" || audience === "private";
  }
  if (audience === "private") return false;
  if (audience === "close") return visibility.closeAuthorIds.has(post.user_id);
  return visibility.friendIds.has(post.user_id);
}

describe("home feed mode rules", () => {
  test("public mode only includes audience=public", () => {
    expect(normalizeAudience("public")).toBe("public");
    expect(normalizeAudience("friends")).not.toBe("public");
  });

  test("private mode excludes public and only-me of others", () => {
    const visibility = ctx({ friendIds: new Set(["friend"]), closeAuthorIds: new Set(["closer"]) });
    expect(acceptPrivate("me", { user_id: "friend", audience: "public" }, visibility)).toBe(false);
    expect(acceptPrivate("me", { user_id: "stranger", audience: "private" }, visibility)).toBe(false);
    expect(acceptPrivate("me", { user_id: "friend", audience: "friends" }, visibility)).toBe(true);
    expect(acceptPrivate("me", { user_id: "closer", audience: "close" }, visibility)).toBe(true);
    expect(acceptPrivate("me", { user_id: "me", audience: "friends" }, visibility)).toBe(true);
    expect(acceptPrivate("me", { user_id: "me", audience: "public" }, visibility)).toBe(false);
  });

  test("pending non-friend cannot see friends-only", () => {
    const visibility = ctx();
    expect(
      canViewerSeeMoment("viewer", { user_id: "author", audience: "friends" }, visibility)
    ).toBe(false);
  });

  test("close membership required for close audience", () => {
    const visibility = ctx({ friendIds: new Set(["author"]) });
    expect(canViewerSeeMoment("viewer", { user_id: "author", audience: "close" }, visibility)).toBe(
      false
    );
    visibility.closeAuthorIds.add("author");
    expect(canViewerSeeMoment("viewer", { user_id: "author", audience: "close" }, visibility)).toBe(
      true
    );
  });
});
