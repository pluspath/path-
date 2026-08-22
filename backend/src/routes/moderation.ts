import { Hono } from "hono";
import { createUserClient, supabaseAdmin } from "../supabase";
import { isUuid } from "../lib/auth-helpers";
import { createBlock, removeBlock, listBlockedProfiles } from "../lib/blocks";
import type { HonoVariables } from "../types";

const moderationRouter = new Hono<{ Variables: HonoVariables }>();

/**
 * Persist a report using whichever reports-table shape this environment has.
 * Production has drifted between two schemas; try both (admin, then user JWT).
 */
async function insertReport(opts: {
  userId: string;
  token: string | null;
  reportedUserId: string | null;
  reportedPostId: string | null;
  reason: string;
  details: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const targetType = opts.reportedPostId ? "post" : "user";
  const targetId = (opts.reportedPostId ?? opts.reportedUserId) as string;

  const payloads: Record<string, unknown>[] = [
    {
      reporter_user_id: opts.userId,
      target_type: targetType,
      target_id: targetId,
      reason: opts.reason,
      details: opts.details,
      status: "open",
    },
    {
      reporter_id: opts.userId,
      reported_user_id: opts.reportedUserId,
      reported_post_id: opts.reportedPostId,
      reason: opts.reason,
      details: opts.details,
      status: "pending",
    },
  ];

  const clients = [supabaseAdmin];
  if (opts.token) clients.push(createUserClient(opts.token));

  const errors: string[] = [];
  for (const client of clients) {
    for (const payload of payloads) {
      const { error } = await client.from("reports").insert(payload);
      if (!error) return { ok: true };
      const msg = error.message ?? "insert failed";
      // Duplicate / already reported → treat as success.
      if (/duplicate|unique|already/i.test(msg)) return { ok: true };
      errors.push(msg);
    }
  }

  console.error("[moderation] report insert failed:", errors.join(" | "));
  return { ok: false, message: errors[0] ?? "Failed to submit report" };
}

moderationRouter.post("/reports", async (c) => {
  const userId = c.get("userId");
  const token = c.get("accessToken");
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

  const result = await insertReport({
    userId,
    token,
    reportedUserId,
    reportedPostId,
    reason,
    details,
  });

  if (!result.ok) {
    return c.json({ error: { message: result.message } }, 500);
  }

  return c.json({ data: { ok: true } });
});

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
