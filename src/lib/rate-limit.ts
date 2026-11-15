import { createHash } from "node:crypto";
import { rateLimiter } from "hono-rate-limiter";

function clientKey(c: { req: { header: (name: string) => string | undefined } }): string {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-real-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * Per-session bucket key.
 *
 * The old key was `authorization.slice(0, 48)`. "Bearer " + a JWT header is
 * already ~44 chars and every user's token shares the same header/payload
 * prefix, so ALL users collapsed into one bucket (hence mass 429s on /badge).
 * Hash the whole credential instead so each session gets its own bucket.
 * Unauthenticated callers fall back to their IP.
 */
function authKey(c: { req: { header: (name: string) => string | undefined } }): string {
  const auth = c.req.header("authorization");
  if (auth && auth.length > 7) {
    return `a:${createHash("sha1").update(auth).digest("base64url")}`;
  }
  return `ip:${clientKey(c)}`;
}

/** General API limit — applied to all /api/* routes.
 * Mobile fans out many parallel calls (friends, status, discover, profiles).
 * Keep this high enough that normal friend-request bursts never trip 429s. */
export const apiLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 400,
  standardHeaders: "draft-6",
  keyGenerator: authKey,
});

/** Stricter limit for auth endpoints (signup, OTP, resend). */
export const authLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-6",
  keyGenerator: clientKey,
});

/** Upload endpoints — prevent storage abuse. */
export const uploadLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-6",
  keyGenerator: authKey,
});

/**
 * Moment view receipts — highest write-rate endpoint under Disk I/O pressure.
 * Cap per session so scroll storms cannot exhaust the IO budget.
 */
export const viewLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: "draft-6",
  keyGenerator: authKey,
});

/** Badge polling — exact unread counts are expensive (many COUNT queries). */
export const badgeLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-6",
  keyGenerator: authKey,
});

export { clientKey, authKey };
