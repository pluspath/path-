import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createUserClient, supabaseAdmin } from "../supabase";
import { isUuid } from "../lib/auth-helpers";
import type { HonoVariables } from "../types";

const blocksRouter = new Hono<{ Variables: HonoVariables }>();

blocksRouter.get("/", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const userClient = createUserClient(token);
  const { data: blocks, error } = await userClient
    .from("user_blocks")
    .select("id, blocked_id, created_at")
    .eq("blocker_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    // Table may not exist yet
    if (error.message?.includes("user_blocks") || error.code === "42P01") {
      return c.json({ data: [] });
    }
    return c.json({ error: { message: "Failed to load blocked users" } }, 500);
  }

  const blockedIds = (blocks ?? []).map((b: any) => b.blocked_id);
  let profileMap: Record<string, any> = {};
  if (blockedIds.length > 0) {
    const { data: profiles } = await userClient.from("profiles").select("*").in("id", blockedIds);
    for (const p of profiles ?? []) profileMap[p.id] = p;
  }

  return c.json({
    data: (blocks ?? []).map((b: any) => {
      const p = profileMap[b.blocked_id];
      return {
        id: b.id,
        userId: b.blocked_id,
        user: p
          ? {
              id: p.id,
              name: p.full_name ?? "",
              username: p.username ?? "",
              avatar: p.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.id}`,
            }
          : { id: b.blocked_id, name: "User", username: "", avatar: "" },
        createdAt: b.created_at,
      };
    }),
  });
});

blocksRouter.post(
  "/:userId",
  zValidator("param", z.object({ userId: z.string().uuid() })),
  async (c) => {
    const user = c.get("user");
    const userId = c.get("userId");
    const token = c.get("accessToken");
    if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

    const { userId: targetId } = c.req.valid("param");
    if (targetId === userId) {
      return c.json({ error: { message: "Cannot block yourself" } }, 400);
    }

    const userClient = createUserClient(token);

    // Upsert block
    const { data: block, error } = await userClient
      .from("user_blocks")
      .upsert(
        { blocker_id: userId, blocked_id: targetId },
        { onConflict: "blocker_id,blocked_id" }
      )
      .select("id, blocked_id, created_at")
      .single();

    if (error) {
      console.error("[blocks] create error:", error.message);
      return c.json({ error: { message: "Failed to block user" } }, 500);
    }

    // Remove any friendship between the users
    await userClient
      .from("friendships")
      .delete()
      .or(
        `and(requester_id.eq.${userId},receiver_id.eq.${targetId}),and(requester_id.eq.${targetId},receiver_id.eq.${userId})`
      );

    // Also mark friendship as blocked via service role if preferred for audit
    try {
      await supabaseAdmin.from("friendships").upsert(
        {
          requester_id: userId,
          receiver_id: targetId,
          status: "blocked",
        },
        { onConflict: "requester_id,receiver_id", ignoreDuplicates: true }
      );
    } catch {
      // Optional — friendships unique constraint may differ
    }

    return c.json({ data: { id: block.id, userId: targetId, createdAt: block.created_at } });
  }
);

blocksRouter.delete("/:userId", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const targetId = c.req.param("userId");
  if (!isUuid(targetId)) {
    return c.json({ error: { message: "Invalid user id" } }, 400);
  }

  const userClient = createUserClient(token);
  const { error } = await userClient
    .from("user_blocks")
    .delete()
    .eq("blocker_id", userId)
    .eq("blocked_id", targetId);

  if (error) {
    return c.json({ error: { message: "Failed to unblock user" } }, 500);
  }

  // Clean blocked friendship rows
  await supabaseAdmin
    .from("friendships")
    .delete()
    .eq("status", "blocked")
    .or(
      `and(requester_id.eq.${userId},receiver_id.eq.${targetId}),and(requester_id.eq.${targetId},receiver_id.eq.${userId})`
    );

  return c.body(null, 204);
});

export { blocksRouter };
