import { Hono } from "hono";
import { supabaseAdmin } from "../supabase";
import type { HonoVariables } from "../types";

const uploadRouter = new Hono<{ Variables: HonoVariables }>();

async function handleUpload(c: any, bucket: string, prefix: string) {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    // parseBody() uses Hono's own multipart parser and returns proper File objects
    const body = await c.req.parseBody();
    const file = body["file"];

    if (!file || typeof file === "string") {
      console.error(`[upload] file field is missing or came through as a string (type: ${typeof file})`);
      return c.json({ error: { message: "No file provided" } }, 400);
    }

    const blob = file as File;
    const contentType = blob.type || "image/jpeg";
    const ext = contentType === "image/png" ? "png" : "jpg";
    const fileName = `${prefix}-${userId}-${Date.now()}.${ext}`;

    const arrayBuffer = await blob.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    const { error: uploadError } = await supabaseAdmin.storage
      .from(bucket)
      .upload(fileName, buffer, { contentType, upsert: true });

    if (uploadError) {
      console.error(`[upload] Supabase error for bucket "${bucket}":`, uploadError.message);
      return c.json({ error: { message: uploadError.message } }, 500);
    }

    const { data: urlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(fileName);
    return c.json({ data: { url: urlData.publicUrl } });
  } catch (err: any) {
    console.error(`[upload] Unexpected error:`, err?.message ?? err);
    return c.json({ error: { message: err?.message ?? "Upload failed" } }, 500);
  }
}

uploadRouter.post("/avatar", async (c) => handleUpload(c, "Avatars", "avatar"));
uploadRouter.post("/cover", async (c) => handleUpload(c, "Covers", "cover"));
uploadRouter.post("/image", async (c) => handleUpload(c, "Avatars", "post"));

// Test endpoint: lists all available storage buckets to verify Supabase connection
uploadRouter.get("/test-storage", async (c) => {
  const { data: buckets, error } = await supabaseAdmin.storage.listBuckets();

  if (error) {
    return c.json({
      data: {
        connected: false,
        error: error.message,
        hint: "Check that SUPABASE_SERVICE_ROLE_KEY is set correctly in the ENV tab",
      },
    });
  }

  return c.json({
    data: {
      connected: true,
      bucketCount: buckets.length,
      buckets: buckets.map((b) => ({ id: b.id, name: b.name, public: b.public })),
    },
  });
});

export { uploadRouter };
