import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { adminAuthMiddleware, getActor, type AdminEnv } from "../middlewares/admin-auth";
import { requirePermission } from "../middlewares/rbac";
import { notificationsService } from "../services/notifications.service";
import { sendNotificationSchema } from "../validation/schemas";
import { parsePagination } from "../utils/pagination";
import { fail, ok, paginated } from "../utils/response";

const notificationsRoutes = new Hono<AdminEnv>();
notificationsRoutes.use("*", adminAuthMiddleware);

notificationsRoutes.get("/", requirePermission("notifications:read"), async (c) => {
  try {
    const p = parsePagination({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
    });
    return paginated(c, await notificationsService.list(p));
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to list notifications", 500);
  }
});

notificationsRoutes.post(
  "/send",
  requirePermission("notifications:send"),
  zValidator("json", sendNotificationSchema),
  async (c) => {
    try {
      const result = await notificationsService.send(c.req.valid("json"), getActor(c));
      return ok(c, result);
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : "Send failed", 500);
    }
  }
);

export { notificationsRoutes };
