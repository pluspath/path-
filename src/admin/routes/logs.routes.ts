import { Hono } from "hono";
import { adminAuthMiddleware, type AdminEnv } from "../middlewares/admin-auth";
import { requirePermission } from "../middlewares/rbac";
import { logRepository } from "../repositories/log.repository";
import { parsePagination, toPaginated } from "../utils/pagination";
import { fail, paginated } from "../utils/response";

const logsRoutes = new Hono<AdminEnv>();
logsRoutes.use("*", adminAuthMiddleware);

logsRoutes.get("/", requirePermission("logs:read"), async (c) => {
  try {
    const p = parsePagination({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
      search: c.req.query("search"),
    });
    const category = c.req.query("category") || undefined;
    const { items, total } = await logRepository.list({
      category,
      search: p.search,
      limit: p.limit,
      offset: p.offset,
    });
    return paginated(c, toPaginated(items, total, p.page, p.limit));
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to list logs", 500);
  }
});

export { logsRoutes };
