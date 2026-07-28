import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createUserClient, supabaseAdmin } from "../supabase";
import { isUuid } from "../lib/auth-helpers";
import type { HonoVariables } from "../types";

const reportSchema = z.object({
  targetType: z.enum(["post", "comment", "user", "message", "other"]),
  targetId: z.string().min(1).max(128),
  reason: z.string().min(3).max(200),
  details: z.string().max(2000).optional(),
});

const reportsRouter = new Hono<{ Variables: HonoVariables }>();

/** POST /api/reports — user-facing content/user reports */
reportsRouter.post("/", zValidator("json", reportSchema), async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  if (!user || !userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = c.req.valid("json");

  if (body.targetType === "user" && body.targetId === userId) {
    return c.json({ error: { message: "Cannot report yourself" } }, 400);
  }

  // Prefer service role so reports always land even if RLS policy missing
  const client = supabaseAdmin ?? null;
  if (!client) {
    return c.json({ error: { message: "Reporting unavailable" } }, 503);
  }

  const { data, error } = await client
    .from("reports")
    .insert({
      reporter_user_id: userId,
      target_type: body.targetType,
      target_id: body.targetId,
      reason: body.reason.trim(),
      details: body.details?.trim() || null,
      status: "open",
    })
    .select("id, status, created_at")
    .single();

  if (error) {
    console.error("[reports] create error:", error.message);
    return c.json({ error: { message: "Failed to submit report" } }, 500);
  }

  return c.json({ data: { id: data.id, status: data.status, createdAt: data.created_at } }, 201);
});

reportsRouter.get("/mine", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const userClient = createUserClient(token);
  const { data, error } = await userClient
    .from("reports")
    .select("id, target_type, target_id, reason, status, created_at")
    .eq("reporter_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return c.json({ data: [] });
  }

  return c.json({
    data: (data ?? []).map((r: any) => ({
      id: r.id,
      targetType: r.target_type,
      targetId: r.target_id,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
    })),
  });
});

export { reportsRouter };
