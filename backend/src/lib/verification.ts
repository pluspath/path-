/** Fields a normal profile update must never be allowed to write. */
export const VERIFICATION_WRITE_KEYS = [
  "is_verified",
  "verified",
  "verified_at",
  "verified_by",
  "verification_revoked_at",
  "verification_revoked_by",
] as const;

export function isAccountVerified(row: { is_verified?: boolean | null } | null | undefined): boolean {
  return row?.is_verified === true;
}

export function profilePatchTriesToSetVerification(body: object | null | undefined): boolean {
  if (!body) return false;
  return VERIFICATION_WRITE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(body, key));
}

export function stripVerificationFields<T extends Record<string, unknown>>(patch: T): T {
  const next = { ...patch };
  for (const key of VERIFICATION_WRITE_KEYS) {
    delete next[key];
  }
  return next;
}

export function verificationPatch(verified: boolean, actorId: string, now = new Date().toISOString()) {
  if (verified) {
    return {
      is_verified: true,
      verified_at: now,
      verified_by: actorId,
      verification_revoked_at: null,
      verification_revoked_by: null,
    };
  }
  return {
    is_verified: false,
    verification_revoked_at: now,
    verification_revoked_by: actorId,
  };
}

export function publicVerificationStatus(row: { is_verified?: boolean | null; verified_at?: string | null } | null | undefined) {
  return {
    verified: isAccountVerified(row),
  };
}
