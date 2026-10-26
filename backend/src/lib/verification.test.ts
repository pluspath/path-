import { describe, expect, test } from "bun:test";
import { roleHasPermission } from "../admin/utils/permissions";
import {
  isAccountVerified,
  profilePatchTriesToSetVerification,
  publicVerificationStatus,
  stripVerificationFields,
  verificationPatch,
} from "./verification";

describe("account verification", () => {
  test("missing and false statuses are unverified", () => {
    expect(isAccountVerified(null)).toBe(false);
    expect(isAccountVerified({})).toBe(false);
    expect(isAccountVerified({ is_verified: false })).toBe(false);
    expect(isAccountVerified({ is_verified: true })).toBe(true);
  });

  test("public responses expose only the badge flag", () => {
    expect(publicVerificationStatus({ is_verified: true, verified_at: "2026-01-01" })).toEqual({
      verified: true,
    });
    expect(publicVerificationStatus({ is_verified: false })).toEqual({ verified: false });
  });

  test("profile updates cannot carry verification fields", () => {
    expect(profilePatchTriesToSetVerification({ name: "Ada" })).toBe(false);
    expect(profilePatchTriesToSetVerification({ is_verified: true })).toBe(true);
    expect(profilePatchTriesToSetVerification({ verified: false })).toBe(true);
    const cleaned = stripVerificationFields({
      full_name: "Ada",
      is_verified: true,
      verified_by: "admin",
    });
    expect(cleaned).toEqual({ full_name: "Ada" });
  });

  test("grant and revoke patches record the administrator", () => {
    const granted = verificationPatch(true, "admin-1", "2026-10-26T00:00:00.000Z");
    expect(granted.is_verified).toBe(true);
    expect(granted.verified_by).toBe("admin-1");
    expect(granted.verification_revoked_at).toBeNull();
    const revoked = verificationPatch(false, "admin-2", "2026-10-26T01:00:00.000Z");
    expect(revoked.is_verified).toBe(false);
    expect(revoked.verification_revoked_by).toBe("admin-2");
  });

  test("only admins with users:verify may grant or revoke", () => {
    expect(roleHasPermission("super_admin", "users:verify")).toBe(true);
    expect(roleHasPermission("admin", "users:verify")).toBe(true);
    expect(roleHasPermission("moderator", "users:verify")).toBe(false);
  });
});
