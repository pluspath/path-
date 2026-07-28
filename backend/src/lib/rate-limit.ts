import { rateLimiter } from "hono-rate-limiter";

function clientKey(c: { req: { header: (name: string) => string | undefined } }): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown"
  );
}

/** General API limit — applied to all /api/* routes. */
export const apiLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-6",
  keyGenerator: clientKey,
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
  keyGenerator: (c) =>
    c.req.header("authorization")?.slice(0, 48) || clientKey(c),
});
