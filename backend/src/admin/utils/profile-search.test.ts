import { describe, expect, test } from "bun:test";
import { profileSearchFilter } from "./profile-search";

describe("profile search", () => {
  test("matches username, display name, and location", () => {
    const filter = profileSearchFilter("sara", null);
    expect(filter).toContain("username.ilike.%sara%");
    expect(filter).toContain("full_name.ilike.%sara%");
    expect(filter).toContain("location.ilike.%sara%");
  });

  test("adds the account id when an email lookup resolves", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(profileSearchFilter("sara@example.com", id)).toContain(`id.eq.${id}`);
  });

  test("matches a pasted account id", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    expect(profileSearchFilter(id, null)).toContain(`id.eq.${id}`);
  });
});
