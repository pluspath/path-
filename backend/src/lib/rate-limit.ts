import { rateLimiter } from "hono-rate-limiter";

function clientKey(c: { req: { header: (name: string) => string | undefined } }) {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "anon"
  );
}

/** General API traffic */
export const apiLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-6",
  keyGenerator: clientKey,
});

/** Auth / OTP / signup */
export const authLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-6",
  keyGenerator: clientKey,
});

/** Google Places proxy */
export const placesLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-6",
  keyGenerator: clientKey,
});

/** Media uploads */
export const uploadLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-6",
  keyGenerator: clientKey,
});
