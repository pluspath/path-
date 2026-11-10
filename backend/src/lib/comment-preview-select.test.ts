import { describe, expect, test } from "bun:test";
import { newestPerPost, pickCommentPreview } from "./comment-preview-select";

type Row = {
  id: string;
  post_id: string;
  user_id: string;
  created_at: string;
};

const row = (
  id: string,
  user_id: string,
  created_at: string,
  post_id = "p1",
): Row => ({ id, post_id, user_id, created_at });

describe("pickCommentPreview", () => {
  test("A: no viewer comment → latest overall", () => {
    const picked = pickCommentPreview(
      [
        row("c1", "u2", "2026-01-01T10:00:00Z"),
        row("c2", "u3", "2026-01-02T10:00:00Z"),
      ],
      "me",
    );
    expect(picked?.id).toBe("c2");
  });

  test("B: viewer has one comment → that comment", () => {
    const picked = pickCommentPreview(
      [
        row("c1", "u2", "2026-01-03T10:00:00Z"),
        row("c2", "me", "2026-01-01T10:00:00Z"),
      ],
      "me",
    );
    expect(picked?.id).toBe("c2");
  });

  test("C: viewer has multiple → their latest", () => {
    const picked = pickCommentPreview(
      [
        row("c1", "me", "2026-01-01T10:00:00Z"),
        row("c2", "me", "2026-01-03T10:00:00Z"),
        row("c3", "u2", "2026-01-04T10:00:00Z"),
      ],
      "me",
    );
    expect(picked?.id).toBe("c2");
  });

  test("D: others newer → still viewer latest", () => {
    const picked = pickCommentPreview(
      [
        row("mine", "me", "2026-01-01T10:00:00Z"),
        row("newer", "u2", "2026-01-05T10:00:00Z"),
      ],
      "me",
    );
    expect(picked?.id).toBe("mine");
  });

  test("E: no comments → null", () => {
    expect(pickCommentPreview([], "me")).toBeNull();
  });

  test("blocked authors are skipped for overall latest", () => {
    const picked = pickCommentPreview(
      [
        row("blocked", "bad", "2026-01-05T10:00:00Z"),
        row("ok", "u2", "2026-01-01T10:00:00Z"),
      ],
      "me",
      ["bad"],
    );
    expect(picked?.id).toBe("ok");
  });

  test("viewer comment is kept even if somehow also blocked", () => {
    const picked = pickCommentPreview(
      [row("mine", "me", "2026-01-01T10:00:00Z"), row("other", "u2", "2026-01-02T10:00:00Z")],
      "me",
      ["me"],
    );
    expect(picked?.id).toBe("mine");
  });
});

describe("newestPerPost", () => {
  test("keeps newest row per post", () => {
    const map = newestPerPost([
      row("a1", "me", "2026-01-01T10:00:00Z", "p1"),
      row("a2", "me", "2026-01-03T10:00:00Z", "p1"),
      row("b1", "me", "2026-01-02T10:00:00Z", "p2"),
    ]);
    expect(map.get("p1")?.id).toBe("a2");
    expect(map.get("p2")?.id).toBe("b1");
  });
});
