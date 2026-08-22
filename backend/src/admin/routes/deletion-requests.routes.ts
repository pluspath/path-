import { Hono } from "hono";
import { adminAuthMiddleware, getActor, type AdminEnv } from "../middlewares/admin-auth";
import { requirePermission } from "../middlewares/rbac";
import { supabaseAdmin } from "../../supabase";
import { fail, ok, paginated } from "../utils/response";
import { parsePagination } from "../utils/pagination";
import { usersService } from "../services/users.service";
import { logRepository } from "../repositories/log.repository";

const deletionRequestsRoutes = new Hono<AdminEnv>();
deletionRequestsRoutes.use("*", adminAuthMiddleware);

deletionRequestsRoutes.get("/", requirePermission("users:read"), async (c) => {
  try {
    const p = parsePagination({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
      search: c.req.query("search"),
    });
    const status = c.req.query("status") || "pending";

    let q = supabaseAdmin
      .from("account_deletion_requests")
      .select("*, profiles:user_id(id, username, full_name, avatar_url)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(p.offset, p.offset + p.limit - 1);

    if (status && status !== "all") q = q.eq("status", status);

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);

    const total = count ?? 0;
    return paginated(c, {
      items: data ?? [],
      total,
      page: p.page,
      limit: p.limit,
      totalPages: Math.max(1, Math.ceil(total / p.limit)),
    });
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to list deletion requests", 500);
  }
});

deletionRequestsRoutes.post("/:id/approve", requirePermission("users:delete"), async (c) => {
  try {
    const id = c.req.param("id");
    const actor = getActor(c);

    const { data: reqRow, error } = await supabaseAdmin
      .from("account_deletion_requests")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !reqRow) return fail(c, "Request not found", 404);
    if (reqRow.status !== "pending" && reqRow.status !== "approved") {
      return fail(c, `Cannot approve request in status ${reqRow.status}`, 400);
    }

    const userId = reqRow.user_id as string;

    await supabaseAdmin
      .from("account_deletion_requests")
      .update({
        status: "approved",
        processed_at: new Date().toISOString(),
        processed_by: actor.id,
      })
      .eq("id", id);

    await usersService.delete(userId, { id: actor.id, name: actor.name });

    await supabaseAdmin
      .from("account_deletion_requests")
      .update({ status: "done", processed_at: new Date().toISOString() })
      .eq("id", id);

    await logRepository.create({
      category: "admin_activity",
      action: "account_deletion.approve",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "user",
      target_id: userId,
      metadata: { requestId: id },
    });

    return ok(c, { id, status: "done" });
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Approve failed", 500);
  }
});

deletionRequestsRoutes.post("/:id/reject", requirePermission("users:delete"), async (c) => {
  try {
    const id = c.req.param("id");
    const actor = getActor(c);
    const body = await c.req.json().catch(() => ({}));
    const note = body?.note ? String(body.note).slice(0, 1000) : null;

    const { data: reqRow } = await supabaseAdmin
      .from("account_deletion_requests")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();

    if (!reqRow) return fail(c, "Request not found", 404);
    if (reqRow.status !== "pending") return fail(c, "Only pending requests can be rejected", 400);

    const { data, error } = await supabaseAdmin
      .from("account_deletion_requests")
      .update({
        status: "rejected",
        admin_note: note,
        processed_at: new Date().toISOString(),
        processed_by: actor.id,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return ok(c, data);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Reject failed", 500);
  }
});

export { deletionRequestsRoutes };
