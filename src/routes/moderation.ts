import { Hono } from "hono";
import { supabaseAdmin } from "../supabase";
import type { HonoVariables } from "../types";

const moderationRouter = new Hono<{ Variables: HonoVariables }>();

// ─── Reporting ───────────────────────────────────────────────────────────
// POST /api/reports
// body: { reportedUserId?, reportedPostId?, reason, details? }
moderationRouter.post("/reports", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = await c.req.json().catch(() => ({}));
  const reportedUserId: string | null = body?.reportedUserId ?? null;
  const reportedPostId: string | null = body?.reportedPostId ?? null;
  const reason: string = (body?.reason ?? "").toString().trim();
  const details: string | null = body?.details ? body.details.toString() : null;

  // Need a reason AND a target (user and/or post).
  if (!reason || (!reportedUserId && !reportedPostId)) {
    return c.json({ error: { message: "A reason and a target are required" } }, 400);
  }

  // Dedupe: don't insert a second pending report for the same target by the
  // same reporter. A post report is keyed on (reporter, post); a user-only
  // report is keyed on (reporter, reported_user).
  let dupeQuery = supabaseAdmin
    .from("reports")
    .select("id")
    .eq("reporter_id", userId)
    .eq("status", "pending");

  if (reportedPostId) {
    dupeQuery = dupeQuery.eq("reported_post_id", reportedPostId);
  } else {
    dupeQuery = dupeQuery.eq("reported_user_id", reportedUserId as string);
  }

  const { data: existing } = await dupeQuery.limit(1).maybeSingle();
  if (existing) return c.json({ data: { ok: true } });

  const { error } = await supabaseAdmin.from("reports").insert({
    reporter_id: userId,
    reported_user_id: reportedUserId,
    reported_post_id: reportedPostId,
    reason,
    details,
    status: "pending",
  });

  if (error) {
    console.error("[moderation] create report error:", error);
    return c.json({ error: { message: "Failed to submit report" } }, 500);
  }

  return c.json({ data: { ok: true } });
});

// ─── Blocking ────────────────────────────────────────────────────────────
// POST /api/blocks/:userId  — block :userId
moderationRouter.post("/blocks/:userId", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { userId: targetId } = c.req.param();
  if (!targetId || targetId === userId) {
    return c.json({ error: { message: "Cannot block yourself" } }, 400);
  }

  // Dedupe: already blocked → success without inserting again.
  const { data: existing } = await supabaseAdmin
    .from("blocks")
    .select("id")
    .eq("blocker_id", userId)
    .eq("blocked_id", targetId)
    .limit(1)
    .maybeSingle();

  if (existing) return c.json({ data: { ok: true } });

  const { error } = await supabaseAdmin
    .from("blocks")
    .insert({ blocker_id: userId, blocked_id: targetId });

  if (error) {
    console.error("[moderation] create block error:", error);
    return c.json({ error: { message: "Failed to block user" } }, 500);
  }

  return c.json({ data: { ok: true } });
});

// DELETE /api/blocks/:userId  — unblock :userId
moderationRouter.delete("/blocks/:userId", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { userId: targetId } = c.req.param();
  if (!targetId) return c.json({ error: { message: "Missing user" } }, 400);

  const { error } = await supabaseAdmin
    .from("blocks")
    .delete()
    .eq("blocker_id", userId)
    .eq("blocked_id", targetId);

  if (error) {
    console.error("[moderation] delete block error:", error);
    return c.json({ error: { message: "Failed to unblock user" } }, 500);
  }

  return c.json({ data: { ok: true } });
});

// GET /api/blocks  — profiles the current user has blocked (one direction:
// blocked_id where blocker_id = me) so the client can render an Unblock list.
moderationRouter.get("/blocks", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { data: rows } = await supabaseAdmin
    .from("blocks")
    .select("blocked_id, created_at")
    .eq("blocker_id", userId)
    .order("created_at", { ascending: false });

  const blockedIds = (rows ?? []).map((r: any) => r.blocked_id).filter(Boolean);
  if (blockedIds.length === 0) return c.json({ data: [] });

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, username, full_name, avatar_url")
    .in("id", blockedIds);

  const byId: Record<string, any> = {};
  for (const p of profiles ?? []) byId[p.id] = p;

  // Preserve most-recently-blocked-first ordering.
  const ordered = blockedIds
    .map((id: string) => byId[id])
    .filter(Boolean)
    .map((p: any) => ({
      id: p.id,
      username: p.username ?? "",
      name: p.full_name ?? "",
      avatar: p.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.id}`,
    }));

  return c.json({ data: ordered });
});

export { moderationRouter };
