import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { rateLimiter } from "hono-rate-limiter";
import {
  changePasswordSchema,
  loginSchema,
  resetPasswordConfirmSchema,
  resetPasswordRequestSchema,
} from "../validation/schemas";
import { authService, AuthError } from "../services/auth.service";
import { adminAuthMiddleware, type AdminEnv } from "../middlewares/admin-auth";
import { fail, ok } from "../utils/response";
import { clientKey } from "../../lib/rate-limit";
import { env } from "../../env";
import { supabaseAdmin } from "../../supabase";

const authRoutes = new Hono<AdminEnv>();

const loginLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-6",
  keyGenerator: clientKey,
});

/** Public readiness for login troubleshooting (no secrets). */
authRoutes.get("/ready", async (c) => {
  let adminTablesOk = false;
  let adminUserCount: number | null = null;
  let tablesMessage = "ok";
  try {
    const { count, error } = await supabaseAdmin
      .from("admin_users")
      .select("id", { count: "exact", head: true });
    if (error) {
      tablesMessage = error.message;
    } else {
      adminTablesOk = true;
      adminUserCount = count ?? 0;
    }
  } catch (e) {
    tablesMessage = e instanceof Error ? e.message : String(e);
  }

  const jwtConfigured = Boolean(env.ADMIN_JWT_SECRET && env.ADMIN_JWT_SECRET.length >= 32);
  const serviceRoleConfigured = Boolean(env.SUPABASE_SERVICE_ROLE_KEY);

  return ok(c, {
    jwtConfigured,
    serviceRoleConfigured,
    adminTablesOk,
    adminUserCount,
    tablesMessage,
    backendUrl: env.BACKEND_URL,
    canLogin: jwtConfigured && serviceRoleConfigured && adminTablesOk && (adminUserCount ?? 0) > 0,
  });
});

authRoutes.post("/login", loginLimiter, zValidator("json", loginSchema), async (c) => {
  try {
    const body = c.req.valid("json");
    const result = await authService.login(body.username, body.password, {
      ip: clientKey(c),
      userAgent: c.req.header("user-agent") ?? undefined,
    });
    return ok(c, result);
  } catch (e) {
    if (e instanceof AuthError) return fail(c, e.message, e.status);
    const message = e instanceof Error ? e.message : String(e);
    console.error("[admin] login failed:", message);
    if (message.includes("ADMIN_JWT_SECRET")) {
      return fail(c, "Admin JWT is not configured on the server. Set ADMIN_JWT_SECRET and restart.", 503);
    }
    if (message.includes("admin_users") || message.includes("schema cache")) {
      return fail(
        c,
        "Admin tables are missing. Run migrations/001_admin_system.sql in the Supabase SQL Editor.",
        503
      );
    }
    return fail(c, "Login failed due to a server error. Check API logs.", 500);
  }
});

authRoutes.post("/logout", adminAuthMiddleware, async (c) => {
  const header = c.req.header("Authorization");
  if (header?.startsWith("Bearer ")) {
    await authService.logout(header.slice(7), {
      ip: c.req.header("x-forwarded-for") ?? undefined,
      userAgent: c.req.header("user-agent") ?? undefined,
    });
  }
  return ok(c, { success: true });
});

authRoutes.get("/me", adminAuthMiddleware, async (c) => {
  try {
    const adminId = c.get("adminId")!;
    const result = await authService.me(adminId);
    return ok(c, result);
  } catch (e) {
    if (e instanceof AuthError) return fail(c, e.message, e.status);
    throw e;
  }
});

authRoutes.post(
  "/change-password",
  adminAuthMiddleware,
  zValidator("json", changePasswordSchema),
  async (c) => {
    try {
      const body = c.req.valid("json");
      await authService.changePassword(c.get("adminId")!, body.currentPassword, body.newPassword);
      return ok(c, { success: true });
    } catch (e) {
      if (e instanceof AuthError) return fail(c, e.message, e.status);
      throw e;
    }
  }
);

authRoutes.post(
  "/reset-password/request",
  loginLimiter,
  zValidator("json", resetPasswordRequestSchema),
  async (c) => {
    const body = c.req.valid("json");
    const result = await authService.requestPasswordReset(body.username);
    return ok(c, result);
  }
);

authRoutes.post(
  "/reset-password/confirm",
  loginLimiter,
  zValidator("json", resetPasswordConfirmSchema),
  async (c) => {
    try {
      const body = c.req.valid("json");
      await authService.confirmPasswordReset(body.token, body.newPassword);
      return ok(c, { success: true });
    } catch (e) {
      if (e instanceof AuthError) return fail(c, e.message, e.status);
      throw e;
    }
  }
);

export { authRoutes };
