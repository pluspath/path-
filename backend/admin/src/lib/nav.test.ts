import { describe, expect, test } from "bun:test";
import { VERIFIED_ACCOUNTS_LABEL, isNavItemVisible } from "./nav";

const verifiedAccounts = {
  href: "/verified-accounts",
  label: VERIFIED_ACCOUNTS_LABEL,
  permission: "users:verify",
  alwaysVisibleExceptModerator: true,
};

describe("admin navigation", () => {
  test("shows Account Verification to every role except moderator", () => {
    const permissions = ["dashboard:read", "users:read"];
    expect(VERIFIED_ACCOUNTS_LABEL).toBe("Account Verification");
    expect(isNavItemVisible(verifiedAccounts, permissions, "admin")).toBe(true);
    expect(isNavItemVisible(verifiedAccounts, permissions, "super_admin")).toBe(true);
    expect(isNavItemVisible(verifiedAccounts, permissions, "owner")).toBe(true);
  });

  test("shows Verified Accounts when the permission is present", () => {
    expect(isNavItemVisible(verifiedAccounts, ["users:verify"], "moderator")).toBe(true);
  });

  test("hides Verified Accounts from moderators without the permission", () => {
    expect(isNavItemVisible(verifiedAccounts, ["users:read", "dashboard:read"], "moderator")).toBe(false);
  });

  test("does not show a normal item just because the role is admin", () => {
    expect(
      isNavItemVisible({ permission: "admins:read" }, ["users:read"], "admin")
    ).toBe(false);
  });
});
