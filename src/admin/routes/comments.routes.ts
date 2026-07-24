import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { adminAuthMiddleware, getActor, type AdminEnv } from "../middlewares/admin-auth";
import { requirePermission } from "../middlewares/rbac";
import { commentsService } from "../services/comments.service";
import { updateCommentSchema } from "../validation/schemas";
import { parsePagination } from "../utils/pagination";
import { fail, ok, paginated } from "../utils/response";

const commentsRoutes = new Hono<AdminEnv>();
commentsRoutes.use("*", adminAuthMiddleware);

commentsRoutes.get("/", requirePermission("comments:read"), async (c) => {
  try {
    const p = parsePagination({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
      search: c.req.query("search"),
    });
    const status = c.req.query("status") || undefined;
    return paginated(c, await commentsService.list({ ...p, status }));
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to list comments", 500);
  }
});

commentsRoutes.patch(
  "/:id",
  requirePermission("comments:write"),
  zValidator("json", updateCommentSchema),
  async (c) => {
    try {
      return ok(c, await commentsService.update(c.req.param("id"), c.req.valid("json"), getActor(c)));
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : "Update failed", 500);
    }
  }
);

commentsRoutes.post("/:id/approve", requirePermission("comments:write"), async (c) => {
  try {
    return ok(c, await commentsService.approve(c.req.param("id"), getActor(c)));
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Approve failed", 500);
  }
});

commentsRoutes.post("/:id/reject", requirePermission("comments:write"), async (c) => {
  try {
    return ok(c, await commentsService.reject(c.req.param("id"), getActor(c)));
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Reject failed", 500);
  }
});

commentsRoutes.post(
  "/:id/reply",
  requirePermission("comments:write"),
  zValidator("json", z.object({ reply: z.string().min(1).max(2000) })),
  async (c) => {
    try {
      return ok(c, await commentsService.reply(c.req.param("id"), c.req.valid("json").reply, getActor(c)));
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : "Reply failed", 500);
    }
  }
);

commentsRoutes.post(
  "/:id/report",
  requirePermission("comments:write"),
  zValidator("json", z.object({ reason: z.string().min(1).max(500) })),
  async (c) => {
    try {
      return ok(
        c,
        await commentsService.reportAbuse(c.req.param("id"), c.req.valid("json").reason, getActor(c))
      );
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : "Report failed", 500);
    }
  }
);

commentsRoutes.delete("/:id", requirePermission("comments:delete"), async (c) => {
  try {
    await commentsService.delete(c.req.param("id"), getActor(c));
    return ok(c, { success: true });
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Delete failed", 500);
  }
});

export { commentsRoutes };
