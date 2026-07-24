import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { adminAuthMiddleware, getActor, type AdminEnv } from "../middlewares/admin-auth";
import { requirePermission } from "../middlewares/rbac";
import { usersService } from "../services/users.service";
import { updateUserSchema } from "../validation/schemas";
import { parsePagination } from "../utils/pagination";
import { fail, ok, paginated } from "../utils/response";

const usersRoutes = new Hono<AdminEnv>();
usersRoutes.use("*", adminAuthMiddleware);

usersRoutes.get("/", requirePermission("users:read"), async (c) => {
  try {
    const p = parsePagination({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
      search: c.req.query("search"),
    });
    const status = c.req.query("status") || undefined;
    const result = await usersService.list({ ...p, status });
    return paginated(c, result);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to list users", 500);
  }
});

usersRoutes.get("/export", requirePermission("users:read"), async (c) => {
  try {
    const csv = await usersService.exportCsv({
      search: c.req.query("search") || undefined,
      status: c.req.query("status") || undefined,
    });
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="users.csv"');
    return c.body(csv);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Export failed", 500);
  }
});

usersRoutes.get("/:id", requirePermission("users:read"), async (c) => {
  try {
    const user = await usersService.get(c.req.param("id"));
    if (!user) return fail(c, "User not found", 404);
    return ok(c, user);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to get user", 500);
  }
});

usersRoutes.get("/:id/activity", requirePermission("users:read"), async (c) => {
  try {
    const activity = await usersService.activity(c.req.param("id"));
    return ok(c, activity);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to load activity", 500);
  }
});

usersRoutes.patch(
  "/:id",
  requirePermission("users:write"),
  zValidator("json", updateUserSchema),
  async (c) => {
    try {
      const updated = await usersService.update(c.req.param("id"), c.req.valid("json"), getActor(c));
      return ok(c, updated);
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : "Update failed", 500);
    }
  }
);

usersRoutes.post("/:id/suspend", requirePermission("users:suspend"), async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const updated = await usersService.suspend(
      c.req.param("id"),
      typeof body.reason === "string" ? body.reason : undefined,
      getActor(c)
    );
    return ok(c, updated);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Suspend failed", 500);
  }
});

usersRoutes.post("/:id/activate", requirePermission("users:suspend"), async (c) => {
  try {
    const updated = await usersService.activate(c.req.param("id"), getActor(c));
    return ok(c, updated);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Activate failed", 500);
  }
});

usersRoutes.post(
  "/:id/reset-password",
  requirePermission("users:write"),
  zValidator("json", z.object({ password: z.string().min(8).max(128) })),
  async (c) => {
    try {
      await usersService.resetPassword(c.req.param("id"), c.req.valid("json").password, getActor(c));
      return ok(c, { success: true });
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : "Reset failed", 500);
    }
  }
);

usersRoutes.post("/:id/verify-email", requirePermission("users:write"), async (c) => {
  try {
    await usersService.verifyEmail(c.req.param("id"), getActor(c));
    return ok(c, { success: true });
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Verify failed", 500);
  }
});

usersRoutes.delete("/:id", requirePermission("users:delete"), async (c) => {
  try {
    await usersService.delete(c.req.param("id"), getActor(c));
    return ok(c, { success: true });
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Delete failed", 500);
  }
});

export { usersRoutes };
