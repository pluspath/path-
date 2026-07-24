import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { adminAuthMiddleware, getActor, type AdminEnv } from "../middlewares/admin-auth";
import { requirePermission } from "../middlewares/rbac";
import { postsService } from "../services/posts.service";
import { createPostSchema, updatePostSchema } from "../validation/schemas";
import { parsePagination } from "../utils/pagination";
import { fail, ok, paginated } from "../utils/response";

const postsRoutes = new Hono<AdminEnv>();
postsRoutes.use("*", adminAuthMiddleware);

postsRoutes.get("/", requirePermission("posts:read"), async (c) => {
  try {
    const p = parsePagination({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
      search: c.req.query("search"),
    });
    const type = c.req.query("type") || undefined;
    const hidden = c.req.query("hidden");
    const published = c.req.query("published");
    const result = await postsService.list({
      ...p,
      type,
      hidden: hidden === undefined ? undefined : hidden === "true",
      published: published === undefined ? undefined : published === "true",
    });
    return paginated(c, result);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to list posts", 500);
  }
});

postsRoutes.get("/:id", requirePermission("posts:read"), async (c) => {
  try {
    const post = await postsService.get(c.req.param("id"));
    if (!post) return fail(c, "Post not found", 404);
    return ok(c, post);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to get post", 500);
  }
});

postsRoutes.post("/", requirePermission("posts:write"), zValidator("json", createPostSchema), async (c) => {
  try {
    const created = await postsService.create(c.req.valid("json"), getActor(c));
    return ok(c, created, 201);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Create failed", 500);
  }
});

postsRoutes.patch("/:id", requirePermission("posts:write"), zValidator("json", updatePostSchema), async (c) => {
  try {
    const updated = await postsService.update(c.req.param("id"), c.req.valid("json"), getActor(c));
    return ok(c, updated);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Update failed", 500);
  }
});

postsRoutes.post("/:id/hide", requirePermission("posts:write"), async (c) => {
  try {
    return ok(c, await postsService.hide(c.req.param("id"), getActor(c)));
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Hide failed", 500);
  }
});

postsRoutes.post("/:id/publish", requirePermission("posts:write"), async (c) => {
  try {
    return ok(c, await postsService.publish(c.req.param("id"), getActor(c)));
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Publish failed", 500);
  }
});

postsRoutes.post("/:id/unpublish", requirePermission("posts:write"), async (c) => {
  try {
    return ok(c, await postsService.unpublish(c.req.param("id"), getActor(c)));
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Unpublish failed", 500);
  }
});

postsRoutes.delete("/:id", requirePermission("posts:delete"), async (c) => {
  try {
    await postsService.delete(c.req.param("id"), getActor(c));
    return ok(c, { success: true });
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Delete failed", 500);
  }
});

export { postsRoutes };
