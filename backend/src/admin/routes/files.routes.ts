import { Hono } from "hono";
import { adminAuthMiddleware, getActor, type AdminEnv } from "../middlewares/admin-auth";
import { requirePermission } from "../middlewares/rbac";
import { filesService } from "../services/files.service";
import { fail, ok } from "../utils/response";

const filesRoutes = new Hono<AdminEnv>();
filesRoutes.use("*", adminAuthMiddleware);

filesRoutes.get("/buckets", requirePermission("files:read"), async (c) => {
  return ok(c, filesService.buckets());
});

filesRoutes.get("/", requirePermission("files:read"), async (c) => {
  try {
    const bucket = c.req.query("bucket") || "Avatars";
    const path = c.req.query("path") || "";
    const search = c.req.query("search") || undefined;
    return ok(c, await filesService.list(bucket, path, search));
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to list files", 500);
  }
});

filesRoutes.delete("/", requirePermission("files:write"), async (c) => {
  try {
    const body = await c.req.json();
    const bucket = String(body.bucket || "");
    const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];
    await filesService.delete(bucket, paths, getActor(c));
    return ok(c, { success: true });
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Delete failed", 500);
  }
});

filesRoutes.post("/replace", requirePermission("files:write"), async (c) => {
  try {
    const form = await c.req.formData();
    const bucket = String(form.get("bucket") || "");
    const path = String(form.get("path") || "");
    const file = form.get("file");
    if (!(file instanceof File)) return fail(c, "file is required", 400);
    return ok(c, await filesService.replace(bucket, path, file, getActor(c)));
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Replace failed", 500);
  }
});

export { filesRoutes };
