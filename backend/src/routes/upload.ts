import { Hono } from "hono";
import { supabaseAdmin } from "../supabase";
import { uploadLimiter } from "../lib/rate-limit";
import type { HonoVariables } from "../types";

const uploadRouter = new Hono<{ Variables: HonoVariables }>();

uploadRouter.use("*", uploadLimiter);

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

function extensionFor(contentType: string): string {
  switch (contentType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    case "video/webm":
      return "webm";
    default:
      return "jpg";
  }
}

async function handleUpload(
  c: any,
  bucket: string,
  prefix: string,
  opts: { allowVideo?: boolean } = {}
) {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const body = await c.req.parseBody();
    const file = body["file"];

    if (!file || typeof file === "string") {
      return c.json({ error: { message: "No file provided" } }, 400);
    }

    const blob = file as File;
    const contentType = (blob.type || "image/jpeg").toLowerCase();
    const isVideo = ALLOWED_VIDEO_TYPES.has(contentType);
    const isImage = ALLOWED_IMAGE_TYPES.has(contentType);

    if (!isImage && !(opts.allowVideo && isVideo)) {
      return c.json({ error: { message: "Unsupported file type" } }, 400);
    }

    const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (typeof blob.size === "number" && blob.size > maxBytes) {
      return c.json(
        { error: { message: `File too large (max ${Math.round(maxBytes / (1024 * 1024))}MB)` } },
        400
      );
    }

    const ext = extensionFor(contentType);
    const fileName = `${prefix}/${userId}/${Date.now()}.${ext}`;
    const buffer = new Uint8Array(await blob.arrayBuffer());

    const { error: uploadError } = await supabaseAdmin.storage
      .from(bucket)
      .upload(fileName, buffer, { contentType, upsert: true });

    if (uploadError) {
      console.error(`[upload] Supabase error for bucket "${bucket}":`, uploadError.message);
      return c.json({ error: { message: "Upload failed" } }, 500);
    }

    const { data: urlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(fileName);
    return c.json({ data: { url: urlData.publicUrl } });
  } catch (err: any) {
    console.error(`[upload] Unexpected error:`, err?.message ?? err);
    return c.json({ error: { message: "Upload failed" } }, 500);
  }
}

uploadRouter.post("/avatar", async (c) => handleUpload(c, "Avatars", "avatar"));
uploadRouter.post("/cover", async (c) => handleUpload(c, "Covers", "cover"));
// Post media lives in the Posts bucket (images + optional video via /post)
uploadRouter.post("/image", async (c) => handleUpload(c, "Posts", "post"));
uploadRouter.post("/post", async (c) => handleUpload(c, "Posts", "post", { allowVideo: true }));

export { uploadRouter };
