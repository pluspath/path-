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

/** Mirrors GET /api/posts?mode=starred accept rules (non-base checks). */
function acceptStarred(
  viewerId: string,
  post: { user_id: string; audience?: string | null },
  myStarredIds: Set<string>,
  visibility: MomentVisibilityContext,
): boolean {
  if (!myStarredIds.has(post.user_id)) return false;
  return canViewerSeeMoment(viewerId, post, visibility);
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

  test("starred mode only includes moments from starred publishers", () => {
    const starred = new Set(["starred"]);
    const visibility = ctx({ friendIds: new Set(["starred", "friend"]) });
    expect(acceptStarred("me", { user_id: "starred", audience: "public" }, starred, visibility)).toBe(true);
    expect(acceptStarred("me", { user_id: "friend", audience: "public" }, starred, visibility)).toBe(false);
    expect(acceptStarred("me", { user_id: "me", audience: "public" }, starred, visibility)).toBe(false);
  });

  test("starred mode never bypasses friends-only or close privacy", () => {
    const starred = new Set(["starred"]);
    const visibility = ctx();
    expect(acceptStarred("me", { user_id: "starred", audience: "friends" }, starred, visibility)).toBe(false);
    expect(acceptStarred("me", { user_id: "starred", audience: "close" }, starred, visibility)).toBe(false);
    expect(acceptStarred("me", { user_id: "starred", audience: "private" }, starred, visibility)).toBe(false);

    visibility.friendIds.add("starred");
    expect(acceptStarred("me", { user_id: "starred", audience: "friends" }, starred, visibility)).toBe(true);
    expect(acceptStarred("me", { user_id: "starred", audience: "close" }, starred, visibility)).toBe(false);

    visibility.closeAuthorIds.add("starred");
    expect(acceptStarred("me", { user_id: "starred", audience: "close" }, starred, visibility)).toBe(true);
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
