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

const authRoutes = new Hono<AdminEnv>();

const loginLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-6",
  keyGenerator: (c) => c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "anon",
});

authRoutes.post("/login", loginLimiter, zValidator("json", loginSchema), async (c) => {
  try {
    const body = c.req.valid("json");
    const result = await authService.login(body.username, body.password, {
      ip: c.req.header("x-forwarded-for") ?? undefined,
      userAgent: c.req.header("user-agent") ?? undefined,
    });
    return ok(c, result);
  } catch (e) {
    if (e instanceof AuthError) return fail(c, e.message, e.status);
    throw e;
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
