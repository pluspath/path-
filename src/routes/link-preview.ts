import { Hono } from "hono";
import { fetchLinkPreview } from "../lib/link-preview";
import type { HonoVariables } from "../types";

const linkPreviewRouter = new Hono<{ Variables: HonoVariables }>();

/**
 * GET /api/link-preview?url=
 * Auth required. Returns `{ data: preview | null }`.
 */
linkPreviewRouter.get("/", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const raw = String(c.req.query("url") ?? "").trim();
  if (!raw) return c.json({ error: { message: "url is required" } }, 400);
  if (raw.length > 2048) return c.json({ error: { message: "url too long" } }, 400);

  const data = await fetchLinkPreview(raw);
  return c.json({ data });
});

export { linkPreviewRouter };
