/** Short-lived auth+profile cache — cuts JWT/profile RTT on bursty mobile traffic. */
export const AUTH_CACHE_TTL_MS = 45_000;

type AuthCacheEntry = { userId: string; profile: any; expires: number };

export const authProfileCache = new Map<string, AuthCacheEntry>();

export function getAuthProfileCache(token: string): AuthCacheEntry | undefined {
  const cached = authProfileCache.get(token);
  if (!cached) return undefined;
  if (cached.expires <= Date.now()) {
    authProfileCache.delete(token);
    return undefined;
  }
  return cached;
}

export function setAuthProfileCache(token: string, userId: string, profile: any): void {
  authProfileCache.set(token, {
    userId,
    profile,
    expires: Date.now() + AUTH_CACHE_TTL_MS,
  });
  // Bound cache size for long-running processes.
  if (authProfileCache.size > 5_000) {
    const first = authProfileCache.keys().next().value;
    if (first) authProfileCache.delete(first);
  }
}

/** Drop a token's cached profile so the next request sees fresh DB values. */
export function invalidateAuthProfileCache(token?: string | null): void {
  if (!token) return;
  authProfileCache.delete(token);
}

/**
 * After a successful profile write, either patch the cached row in place or
 * drop it. Keeps avatar/cover change detection and subsequent GETs accurate.
 */
export function refreshAuthProfileCache(token: string | null | undefined, profile: any): void {
  if (!token || !profile?.id) {
    invalidateAuthProfileCache(token);
    return;
  }
  const existing = authProfileCache.get(token);
  if (existing) {
    authProfileCache.set(token, {
      userId: profile.id,
      profile: { ...existing.profile, ...profile },
      expires: Date.now() + AUTH_CACHE_TTL_MS,
    });
    return;
  }
  setAuthProfileCache(token, profile.id, profile);
}
