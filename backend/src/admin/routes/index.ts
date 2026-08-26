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
import { deletionRequestsRoutes } from "./deletion-requests.routes";
import { settingsRoutes, cmsRoutes } from "./settings.routes";
import { externalServicesRoutes } from "./external-services.routes";
import { filesRoutes } from "./files.routes";
import { logsRoutes } from "./logs.routes";
import { adminsRoutes } from "./admins.routes";
import { healthRoutes } from "./health.routes";
import { logRepository } from "../repositories/log.repository";
import { clientKey } from "../../lib/rate-limit";
import { getAdminAuthReady } from "../services/ready.service";
import { ok } from "../utils/response";
import type { AdminEnv } from "../middlewares/admin-auth";

const adminRouter = new Hono<AdminEnv>();

adminRouter.use("*", secureHeadersMiddleware);

const adminApiLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 180,
  standardHeaders: "draft-6",
  keyGenerator: (c) =>
    c.req.header("authorization")?.slice(0, 40) || clientKey(c),
});

adminRouter.use("*", adminApiLimiter);

adminRouter.use("*", async (c, next) => {
  try {
    await next();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin] unhandled error:", message);
    try {
      await logRepository.create({
        category: "unhandled_exception",
        action: "admin_route_error",
        actor_type: "system",
        metadata: {
          path: c.req.path,
          method: c.req.method,
          message,
        },
        ip_address: clientKey(c),
        user_agent: c.req.header("user-agent") ?? null,
      });
    } catch {
      // ignore secondary log failures
    }

    if (message.includes("ADMIN_JWT_SECRET")) {
      return c.json(
        { error: { message: "Admin JWT is not configured. Set ADMIN_JWT_SECRET and restart the API." } },
        503
      );
    }
    if (message.includes("admin_users") || message.includes("schema cache")) {
      return c.json(
        {
          error: {
            message:
              "Admin tables are missing. Run migrations/001_admin_system.sql in the Supabase SQL Editor.",
          },
        },
        503
      );
    }

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
        "external-services",
        "cms",
        "files",
        "logs",
        "admins",
        "health",
      ],
    },
  })
);

/** Registered on the parent router so it cannot be missed by nested mount issues. */
adminRouter.get("/auth/ready", async (c) => ok(c, await getAdminAuthReady()));

adminRouter.route("/auth", authRoutes);
adminRouter.route("/dashboard", dashboardRoutes);
adminRouter.route("/users", usersRoutes);
adminRouter.route("/posts", postsRoutes);
adminRouter.route("/comments", commentsRoutes);
adminRouter.route("/friendships", friendshipsRoutes);
adminRouter.route("/notifications", notificationsRoutes);
adminRouter.route("/reports", reportsRoutes);
adminRouter.route("/deletion-requests", deletionRequestsRoutes);
adminRouter.route("/settings", settingsRoutes);
adminRouter.route("/external-services", externalServicesRoutes);
adminRouter.route("/cms", cmsRoutes);
adminRouter.route("/files", filesRoutes);
adminRouter.route("/logs", logsRoutes);
adminRouter.route("/admins", adminsRoutes);
adminRouter.route("/health", healthRoutes);

export { adminRouter };
