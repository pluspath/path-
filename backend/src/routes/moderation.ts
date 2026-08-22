import { Hono } from "hono";
import { supabaseAdmin } from "../supabase";
import type { HonoVariables } from "../types";

const moderationRouter = new Hono<{ Variables: HonoVariables }>();

// ─── Reporting ───────────────────────────────────────────────────────────
// POST /api/reports
// body: { reportedUserId?, reportedPostId?, reason, details? }
// Persists into the admin `reports` schema (reporter_user_id / target_type / target_id).
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

  const targetType = reportedPostId ? "post" : "user";
  const targetId = (reportedPostId ?? reportedUserId) as string;

  // Dedupe open reports for the same reporter + target.
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
    return c.json({ error: { message: "Failed to submit report" } }, 500);
  }

  return c.json({ data: { ok: true } });
});

// ─── Blocking ────────────────────────────────────────────────────────────
// Uses `user_blocks` (see migrations/006_social_features.sql) — NOT a fictional `blocks` table.
moderationRouter.post("/blocks/:userId", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { userId: targetId } = c.req.param();
  if (!targetId || targetId === userId) {
    return c.json({ error: { message: "Cannot block yourself" } }, 400);
  }

  const { data: existing } = await supabaseAdmin
    .from("user_blocks")
    .select("id")
    .eq("blocker_id", userId)
    .eq("blocked_id", targetId)
    .limit(1)
    .maybeSingle();

  if (!existing) {
    const { error } = await supabaseAdmin
      .from("user_blocks")
      .insert({ blocker_id: userId, blocked_id: targetId });

    if (error) {
      console.error("[moderation] create block error:", error);
      return c.json({ error: { message: "Failed to block user" } }, 500);
    }
  }

  // Remove any friendship between the users so they disappear from friend lists.
  await supabaseAdmin
    .from("friendships")
    .delete()
    .or(
      `and(requester_id.eq.${userId},receiver_id.eq.${targetId}),and(requester_id.eq.${targetId},receiver_id.eq.${userId})`
    );

  return c.json({ data: { ok: true } });
});

moderationRouter.delete("/blocks/:userId", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { userId: targetId } = c.req.param();
  if (!targetId) return c.json({ error: { message: "Missing user" } }, 400);

  const { error } = await supabaseAdmin
    .from("user_blocks")
    .delete()
    .eq("blocker_id", userId)
    .eq("blocked_id", targetId);

  if (error) {
    console.error("[moderation] delete block error:", error);
    return c.json({ error: { message: "Failed to unblock user" } }, 500);
  }

  return c.json({ data: { ok: true } });
});

moderationRouter.get("/blocks", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { data: rows, error } = await supabaseAdmin
    .from("user_blocks")
    .select("blocked_id, created_at")
    .eq("blocker_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    // Table may not exist yet on a fresh DB — fail soft.
    if (error.message?.includes("user_blocks") || error.code === "42P01") {
      return c.json({ data: [] });
    }
    console.error("[moderation] list blocks error:", error);
    return c.json({ error: { message: "Failed to load blocked users" } }, 500);
  }

  const blockedIds = (rows ?? []).map((r: any) => r.blocked_id).filter(Boolean);
  if (blockedIds.length === 0) return c.json({ data: [] });

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, username, full_name, avatar_url")
    .in("id", blockedIds);

  const byId: Record<string, any> = {};
  for (const p of profiles ?? []) byId[p.id] = p;

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
