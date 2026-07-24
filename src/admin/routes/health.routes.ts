import { Hono } from "hono";
import { adminAuthMiddleware, type AdminEnv } from "../middlewares/admin-auth";
import { requirePermission } from "../middlewares/rbac";
import { healthService } from "../services/health.service";
import { fail, ok } from "../utils/response";

const healthRoutes = new Hono<AdminEnv>();
healthRoutes.use("*", adminAuthMiddleware);

healthRoutes.get("/", requirePermission("health:read"), async (c) => {
  try {
    return ok(c, await healthService.check());
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Health check failed", 500);
  }
});

export { healthRoutes };
