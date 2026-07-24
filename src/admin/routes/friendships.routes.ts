import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { adminAuthMiddleware, getActor, type AdminEnv } from "../middlewares/admin-auth";
import { requirePermission } from "../middlewares/rbac";
import { friendshipsService } from "../services/friendships.service";
import { updateFriendshipSchema } from "../validation/schemas";
import { parsePagination } from "../utils/pagination";
import { fail, ok, paginated } from "../utils/response";

const friendshipsRoutes = new Hono<AdminEnv>();
friendshipsRoutes.use("*", adminAuthMiddleware);

friendshipsRoutes.get("/", requirePermission("friendships:read"), async (c) => {
  try {
    const p = parsePagination({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
      search: c.req.query("search"),
    });
    const status = c.req.query("status") || undefined;
    return paginated(c, await friendshipsService.list({ ...p, status }));
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to list friendships", 500);
  }
});

friendshipsRoutes.get("/export", requirePermission("friendships:read"), async (c) => {
  try {
    const csv = await friendshipsService.exportCsv();
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="friendships.csv"');
    return c.body(csv);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Export failed", 500);
  }
});

friendshipsRoutes.post("/:id/confirm", requirePermission("friendships:write"), async (c) => {
  try {
    return ok(c, await friendshipsService.confirm(c.req.param("id"), getActor(c)));
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Confirm failed", 500);
  }
});

friendshipsRoutes.post("/:id/cancel", requirePermission("friendships:write"), async (c) => {
  try {
    await friendshipsService.cancel(c.req.param("id"), getActor(c));
    return ok(c, { success: true });
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Cancel failed", 500);
  }
});

friendshipsRoutes.patch(
  "/:id",
  requirePermission("friendships:write"),
  zValidator("json", updateFriendshipSchema),
  async (c) => {
    try {
      return ok(c, await friendshipsService.update(c.req.param("id"), c.req.valid("json"), getActor(c)));
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : "Update failed", 500);
    }
  }
);

export { friendshipsRoutes };
