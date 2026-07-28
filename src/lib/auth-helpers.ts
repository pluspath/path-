import type { Context, Next } from "hono";
import type { HonoVariables } from "../types";

type AppContext = Context<{ Variables: HonoVariables }>;

/** Require authenticated mobile user (Supabase JWT + profile). */
export async function requireAuth(c: AppContext, next: Next) {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) {
    return c.json({ error: { message: "Unauthorized" } }, 401);
  }
  await next();
}

export function getAuth(c: AppContext) {
  return {
    user: c.get("user")!,
    userId: c.get("userId")!,
    token: c.get("accessToken")!,
  };
}

/** Sanitize free-text for PostgREST filter fragments (never embed raw user input). */
export function sanitizeSearchQuery(q: string, maxLen = 64): string {
  return q
    .replace(/[%_,.()"'\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}
