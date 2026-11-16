import { Hono } from "hono";
import { adminAuthMiddleware, type AdminEnv } from "../middlewares/admin-auth";
import { requirePermission } from "../middlewares/rbac";
import { dashboardService } from "../services/dashboard.service";
import { fail, ok } from "../utils/response";

const dashboardRoutes = new Hono<AdminEnv>();

dashboardRoutes.use("*", adminAuthMiddleware);

dashboardRoutes.get("/", requirePermission("dashboard:read"), async (c) => {
  try {
    const stats = await dashboardService.getStats();
    return ok(c, stats);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to load dashboard", 500);
  }
});

/** Lightweight poll endpoint for the live online-users indicator. */
dashboardRoutes.get("/presence", requirePermission("dashboard:read"), async (c) => {
  try {
    const presence = await dashboardService.getLivePresence();
    return ok(c, presence);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to load presence", 500);
  }
});

export { dashboardRoutes };
