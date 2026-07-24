import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { adminAuthMiddleware, getActor, type AdminEnv } from "../middlewares/admin-auth";
import { requirePermission } from "../middlewares/rbac";
import { settingsService } from "../services/settings.service";
import { updateContentSchema, updateSettingsSchema } from "../validation/schemas";
import { fail, ok } from "../utils/response";

const settingsRoutes = new Hono<AdminEnv>();
settingsRoutes.use("*", adminAuthMiddleware);

settingsRoutes.get("/", requirePermission("settings:read"), async (c) => {
  try {
    return ok(c, await settingsService.getAll());
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to load settings", 500);
  }
});

settingsRoutes.put("/", requirePermission("settings:write"), zValidator("json", updateSettingsSchema), async (c) => {
  try {
    const body = c.req.valid("json");
    return ok(c, await settingsService.update(body.key, body.value, getActor(c)));
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Update failed", 500);
  }
});

const cmsRoutes = new Hono<AdminEnv>();
cmsRoutes.use("*", adminAuthMiddleware);

cmsRoutes.get("/", requirePermission("cms:read"), async (c) => {
  try {
    return ok(c, await settingsService.listContent());
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to load content", 500);
  }
});

cmsRoutes.get("/:slug", requirePermission("cms:read"), async (c) => {
  try {
    const item = await settingsService.getContent(c.req.param("slug"));
    if (!item) return fail(c, "Content not found", 404);
    return ok(c, item);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to load content", 500);
  }
});

cmsRoutes.put(
  "/:slug",
  requirePermission("cms:write"),
  zValidator("json", updateContentSchema),
  async (c) => {
    try {
      return ok(c, await settingsService.updateContent(c.req.param("slug"), c.req.valid("json"), getActor(c)));
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : "Update failed", 500);
    }
  }
);

export { settingsRoutes, cmsRoutes };
