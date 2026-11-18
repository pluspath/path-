import { describe, expect, test } from "bun:test";

/**
 * Mirrors recipient selection for nested comment replies:
 * parent author + moment owner, excluding the sender, with dedupe.
 */
function replyRecipients(opts: {
  senderId: string;
  parentAuthorId: string | null;
  momentOwnerId: string;
}): string[] {
  const set = new Set<string>();
  if (opts.parentAuthorId && opts.parentAuthorId !== opts.senderId) {
    set.add(opts.parentAuthorId);
  }
  if (opts.momentOwnerId !== opts.senderId) {
    set.add(opts.momentOwnerId);
  }
  return Array.from(set);
}

describe("reply notification recipients", () => {
  test("notifies parent author and moment owner", () => {
    expect(
      replyRecipients({
        senderId: "a",
        parentAuthorId: "b",
        momentOwnerId: "c",
      }).sort()
    ).toEqual(["b", "c"]);
  });

  test("dedupes when parent author owns the moment", () => {
    expect(
      replyRecipients({
        senderId: "a",
        parentAuthorId: "b",
        momentOwnerId: "b",
      })
    ).toEqual(["b"]);
  });

  test("never notifies the sender", () => {
    expect(
      replyRecipients({
        senderId: "a",
        parentAuthorId: "a",
        momentOwnerId: "a",
      })
    ).toEqual([]);
  });

  test("top-level comment path (no parent) still notifies owner", () => {
    expect(
      replyRecipients({
        senderId: "a",
        parentAuthorId: null,
        momentOwnerId: "c",
      })
    ).toEqual(["c"]);
  });
});
