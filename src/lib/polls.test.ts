import { describe, expect, test } from "bun:test";
import { distributePercents, normalizePollPayload } from "./polls";

describe("distributePercents", () => {
  test("zeros stay zero", () => {
    expect(distributePercents([0, 0, 0])).toEqual([0, 0, 0]);
  });

  test("sums to 100 for typical splits", () => {
    const p = distributePercents([1, 1, 1]);
    expect(p.reduce((a, b) => a + b, 0)).toBe(100);
    expect(p).toEqual([34, 33, 33]);
  });

  test("exact percentages", () => {
    expect(distributePercents([65, 25, 10])).toEqual([65, 25, 10]);
  });

  test("single option is 100", () => {
    expect(distributePercents([7])).toEqual([100]);
  });
});

describe("normalizePollPayload", () => {
  test("rejects empty question", () => {
    const r = normalizePollPayload({ question: "  ", options: ["A", "B"] });
    expect(r.ok).toBe(false);
  });

  test("requires at least two options", () => {
    const r = normalizePollPayload({ question: "Q?", options: ["A"] });
    expect(r.ok).toBe(false);
  });

  test("dedupes and trims options", () => {
    const r = normalizePollPayload({
      question: "Favorite?",
      options: ["  Red ", "red", "Blue", ""],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.options).toEqual(["Red", "Blue"]);
    }
  });
});
