import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { adminAuthMiddleware, getActor, type AdminEnv } from "../middlewares/admin-auth";
import { requirePermission } from "../middlewares/rbac";
import { usernamesService } from "../services/usernames.service";
import { parsePagination } from "../utils/pagination";
import { fail, ok } from "../utils/response";

const usernamesRoutes = new Hono<AdminEnv>();
usernamesRoutes.use("*", adminAuthMiddleware);

usernamesRoutes.get("/", requirePermission("users:read"), async (c) => {
  try {
    const p = parsePagination({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
      search: c.req.query("search"),
    });
    const result = await usernamesService.list({ ...p, search: p.search });
    return c.json({ data: result.items, meta: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    }, pendingRegistrations: result.pendingRegistrations });
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to list usernames", 500);
  }
});

usernamesRoutes.post(
  "/release",
  requirePermission("users:write"),
  zValidator("json", z.object({ username: z.string().min(1).max(64) })),
  async (c) => {
    try {
      const result = await usernamesService.release(c.req.valid("json").username, getActor(c));
      return ok(c, result);
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : "Release failed", 400);
    }
  }
);

usernamesRoutes.patch(
  "/:userId",
  requirePermission("users:write"),
  zValidator("json", z.object({ username: z.string().min(3).max(30) })),
  async (c) => {
    try {
      const updated = await usernamesService.rename(
        c.req.param("userId"),
        c.req.valid("json").username,
        getActor(c)
      );
      return ok(c, updated);
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : "Rename failed", 400);
    }
  }
);

usernamesRoutes.delete(
  "/pending/:id",
  requirePermission("users:write"),
  async (c) => {
    try {
      const cleared = await usernamesService.clearPending(c.req.param("id"), getActor(c));
      return ok(c, cleared);
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : "Clear failed", 400);
    }
  }
);

export { usernamesRoutes };
