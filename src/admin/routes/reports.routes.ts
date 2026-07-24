import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { adminAuthMiddleware, getActor, type AdminEnv } from "../middlewares/admin-auth";
import { requirePermission } from "../middlewares/rbac";
import { reportsService } from "../services/reports.service";
import { createReportSchema, updateReportSchema } from "../validation/schemas";
import { parsePagination } from "../utils/pagination";
import { fail, ok, paginated } from "../utils/response";

const reportsRoutes = new Hono<AdminEnv>();
reportsRoutes.use("*", adminAuthMiddleware);

reportsRoutes.get("/", requirePermission("reports:read"), async (c) => {
  try {
    const p = parsePagination({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
      search: c.req.query("search"),
    });
    const status = c.req.query("status") || undefined;
    return paginated(c, await reportsService.list({ ...p, status }));
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to list reports", 500);
  }
});

reportsRoutes.post("/", requirePermission("reports:write"), zValidator("json", createReportSchema), async (c) => {
  try {
    return ok(c, await reportsService.create(c.req.valid("json"), getActor(c)), 201);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Create failed", 500);
  }
});

reportsRoutes.patch(
  "/:id",
  requirePermission("reports:write"),
  zValidator("json", updateReportSchema),
  async (c) => {
    try {
      return ok(c, await reportsService.update(c.req.param("id"), c.req.valid("json"), getActor(c)));
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : "Update failed", 500);
    }
  }
);

reportsRoutes.delete("/:id", requirePermission("reports:write"), async (c) => {
  try {
    await reportsService.delete(c.req.param("id"), getActor(c));
    return ok(c, { success: true });
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Delete failed", 500);
  }
});

export { reportsRoutes };
