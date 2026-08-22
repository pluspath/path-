import { Hono } from "hono";
import { isUuid } from "../lib/auth-helpers";
import { createBlock, removeBlock, listBlockedProfiles } from "../lib/blocks";
import type { HonoVariables } from "../types";

const moderationRouter = new Hono<{ Variables: HonoVariables }>();

// ─── Reporting ───────────────────────────────────────────────────────────
moderationRouter.post("/reports", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = await c.req.json().catch(() => ({}));
  const reportedUserId: string | null = body?.reportedUserId ?? null;
  const reportedPostId: string | null = body?.reportedPostId ?? null;
  const reason: string = (body?.reason ?? "").toString().trim();
  const details: string | null = body?.details ? body.details.toString().trim() : null;

  if (!reason || (!reportedUserId && !reportedPostId)) {
    return c.json({ error: { message: "A reason and a target are required" } }, 400);
  }

  if (reportedUserId && reportedUserId === userId) {
    return c.json({ error: { message: "Cannot report yourself" } }, 400);
  }

  // Lazy-import so block helpers stay the hot path; reports use admin client.
  const { supabaseAdmin } = await import("../supabase");

  const targetType = reportedPostId ? "post" : "user";
  const targetId = (reportedPostId ?? reportedUserId) as string;

  const { data: existing } = await supabaseAdmin
    .from("reports")
    .select("id")
    .eq("reporter_user_id", userId)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  if (existing) return c.json({ data: { ok: true } });

  const { error } = await supabaseAdmin.from("reports").insert({
    reporter_user_id: userId,
    target_type: targetType,
    target_id: targetId,
    reason,
    details,
    status: "open",
  });

  if (error) {
    console.error("[moderation] create report error:", error);
    // Column-name drift across environments: retry with the alternate schema
    // used by some older admin migrations (reporter_id / reported_*).
    const { error: altError } = await supabaseAdmin.from("reports").insert({
      reporter_id: userId,
      reported_user_id: reportedUserId,
      reported_post_id: reportedPostId,
      reason,
      details,
      status: "pending",
    });
    if (altError) {
      console.error("[moderation] create report alt schema error:", altError);
      return c.json({ error: { message: "Failed to submit report" } }, 500);
    }
  }

  return c.json({ data: { ok: true } });
});

// ─── Blocking ────────────────────────────────────────────────────────────
moderationRouter.post("/blocks/:userId", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const targetId = c.req.param("userId");
  if (!targetId || !isUuid(targetId)) {
    return c.json({ error: { message: "Invalid user id" } }, 400);
  }
  if (targetId === userId) {
    return c.json({ error: { message: "Cannot block yourself" } }, 400);
  }

  const result = await createBlock(userId, targetId, token);
  if (!result.ok) {
    return c.json({ error: { message: result.message } }, 500);
  }

  return c.json({ data: { ok: true } });
});

moderationRouter.delete("/blocks/:userId", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const targetId = c.req.param("userId");
  if (!targetId || !isUuid(targetId)) {
    return c.json({ error: { message: "Invalid user id" } }, 400);
  }

  const result = await removeBlock(userId, targetId, token);
  if (!result.ok) {
    return c.json({ error: { message: result.message } }, 500);
  }

  return c.json({ data: { ok: true } });
});

moderationRouter.get("/blocks", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const ordered = await listBlockedProfiles(userId, token);
    return c.json({ data: ordered });
  } catch (err: any) {
    console.error("[moderation] list blocks error:", err);
    return c.json({ error: { message: "Failed to load blocked users" } }, 500);
  }
});

export { moderationRouter };
