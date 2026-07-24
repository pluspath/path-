import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { adminAuthMiddleware, getActor, type AdminEnv } from "../middlewares/admin-auth";
import { requirePermission } from "../middlewares/rbac";
import { adminsService } from "../services/admins.service";
import { createAdminSchema, updateAdminSchema } from "../validation/schemas";
import { fail, ok } from "../utils/response";

const adminsRoutes = new Hono<AdminEnv>();
adminsRoutes.use("*", adminAuthMiddleware);

adminsRoutes.get("/roles", requirePermission("admins:read"), async (c) => {
  return ok(c, adminsService.rolesMatrix());
});

adminsRoutes.get("/", requirePermission("admins:read"), async (c) => {
  try {
    return ok(c, await adminsService.list());
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to list admins", 500);
  }
});

adminsRoutes.post("/", requirePermission("admins:write"), zValidator("json", createAdminSchema), async (c) => {
  try {
    return ok(c, await adminsService.create(c.req.valid("json"), getActor(c)), 201);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Create failed", 500);
  }
});

adminsRoutes.patch(
  "/:id",
  requirePermission("admins:write"),
  zValidator("json", updateAdminSchema),
  async (c) => {
    try {
      return ok(c, await adminsService.update(c.req.param("id"), c.req.valid("json"), getActor(c)));
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : "Update failed", 500);
    }
  }
);

adminsRoutes.delete("/:id", requirePermission("admins:write"), async (c) => {
  try {
    await adminsService.delete(c.req.param("id"), getActor(c));
    return ok(c, { success: true });
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Delete failed", 500);
  }
});

export { adminsRoutes };
