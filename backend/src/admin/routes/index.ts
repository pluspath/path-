import { Hono } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import { secureHeadersMiddleware } from "../middlewares/secure-headers";
import { authRoutes } from "./auth.routes";
import { dashboardRoutes } from "./dashboard.routes";
import { usersRoutes } from "./users.routes";
import { postsRoutes } from "./posts.routes";
import { commentsRoutes } from "./comments.routes";
import { friendshipsRoutes } from "./friendships.routes";
import { notificationsRoutes } from "./notifications.routes";
import { reportsRoutes } from "./reports.routes";
import { settingsRoutes, cmsRoutes } from "./settings.routes";
import { filesRoutes } from "./files.routes";
import { logsRoutes } from "./logs.routes";
import { adminsRoutes } from "./admins.routes";
import { healthRoutes } from "./health.routes";
import { logRepository } from "../repositories/log.repository";
import type { AdminEnv } from "../middlewares/admin-auth";

const adminRouter = new Hono<AdminEnv>();

adminRouter.use("*", secureHeadersMiddleware);

const adminApiLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 180,
  standardHeaders: "draft-6",
  keyGenerator: (c) =>
    c.req.header("authorization")?.slice(0, 40) ||
    c.req.header("x-forwarded-for") ||
    "admin-anon",
});

adminRouter.use("*", adminApiLimiter);

adminRouter.use("*", async (c, next) => {
  try {
    await next();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin] unhandled error:", message);
    await logRepository.create({
      category: "unhandled_exception",
      action: "admin_route_error",
      actor_type: "system",
      metadata: {
        path: c.req.path,
        method: c.req.method,
        message,
      },
      ip_address: c.req.header("x-forwarded-for") ?? null,
      user_agent: c.req.header("user-agent") ?? null,
    });
    return c.json({ error: { message: "Internal server error" } }, 500);
  }
});

adminRouter.get("/", (c) =>
  c.json({
    data: {
      name: "Path+ Admin API",
      version: "1.0.0",
      modules: [
        "auth",
        "dashboard",
        "users",
        "posts",
        "comments",
        "friendships",
        "notifications",
        "reports",
        "settings",
        "cms",
        "files",
        "logs",
        "admins",
        "health",
      ],
    },
  })
);

adminRouter.route("/auth", authRoutes);
adminRouter.route("/dashboard", dashboardRoutes);
adminRouter.route("/users", usersRoutes);
adminRouter.route("/posts", postsRoutes);
adminRouter.route("/comments", commentsRoutes);
adminRouter.route("/friendships", friendshipsRoutes);
adminRouter.route("/notifications", notificationsRoutes);
adminRouter.route("/reports", reportsRoutes);
adminRouter.route("/settings", settingsRoutes);
adminRouter.route("/cms", cmsRoutes);
adminRouter.route("/files", filesRoutes);
adminRouter.route("/logs", logsRoutes);
adminRouter.route("/admins", adminsRoutes);
adminRouter.route("/health", healthRoutes);

export { adminRouter };
