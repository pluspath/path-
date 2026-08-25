import { Hono } from "hono";
import { supabaseAdmin } from "../supabase";
import type { HonoVariables } from "../types";

const uploadRouter = new Hono<{ Variables: HonoVariables }>();

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

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/aac",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
]);

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

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
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/webm":
      return "webm";
    case "audio/aac":
      return "aac";
    case "audio/mp4":
    case "audio/m4a":
    case "audio/x-m4a":
      return "m4a";
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
      console.error(`[upload] file field is missing or came through as a string (type: ${typeof file})`);
      return c.json({ error: { message: "No file provided" } }, 400);
    }

    const blob = file as File;
    // RN FormData often omits MIME — sniff from the filename when missing.
    const rawName = (blob as any).name ? String((blob as any).name).toLowerCase() : "";
    let contentType = (blob.type || "").toLowerCase();
    if (!contentType || contentType === "application/octet-stream") {
      if (rawName.endsWith(".mov")) contentType = "video/quicktime";
      else if (rawName.endsWith(".webm")) contentType = "video/webm";
      else if (rawName.endsWith(".mp4") || rawName.endsWith(".m4v")) contentType = "video/mp4";
      else if (rawName.endsWith(".png")) contentType = "image/png";
      else if (rawName.endsWith(".webp")) contentType = "image/webp";
      else if (rawName.endsWith(".gif")) contentType = "image/gif";
      else if (opts.allowVideo) contentType = "video/mp4";
      else contentType = "image/jpeg";
    }

    const isVideo = ALLOWED_VIDEO_TYPES.has(contentType);
    const isImage = ALLOWED_IMAGE_TYPES.has(contentType);

    if (!isImage && !(opts.allowVideo && isVideo)) {
      return c.json({ error: { message: `Unsupported file type: ${contentType || "unknown"}` } }, 400);
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
      return c.json({ error: { message: uploadError.message } }, 500);
    }

    const { data: urlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(fileName);
    return c.json({ data: { url: urlData.publicUrl } });
  } catch (err: any) {
    console.error(`[upload] Unexpected error:`, err?.message ?? err);
    return c.json({ error: { message: err?.message ?? "Upload failed" } }, 500);
  }
}

async function handleAudioUpload(c: any, bucket: string, prefix: string) {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const body = await c.req.parseBody();
    const file = body["file"];

    if (!file || typeof file === "string") {
      return c.json({ error: { message: "No file provided" } }, 400);
    }

    const blob = file as File;
    const rawName = (blob as any).name ? String((blob as any).name).toLowerCase() : "";
    let contentType = (blob.type || "").toLowerCase();
    if (!contentType || contentType === "application/octet-stream") {
      if (rawName.endsWith(".mp3")) contentType = "audio/mpeg";
      else if (rawName.endsWith(".wav")) contentType = "audio/wav";
      else if (rawName.endsWith(".webm")) contentType = "audio/webm";
      else if (rawName.endsWith(".aac")) contentType = "audio/aac";
      else contentType = "audio/mp4";
    }

    if (!ALLOWED_AUDIO_TYPES.has(contentType)) {
      return c.json({ error: { message: `Unsupported audio type: ${contentType || "unknown"}` } }, 400);
    }

    if (typeof blob.size === "number" && blob.size > MAX_AUDIO_BYTES) {
      return c.json({ error: { message: "File too large (max 25MB)" } }, 400);
    }

    const ext = extensionFor(contentType);
    const fileName = `${prefix}/${userId}/${Date.now()}.${ext}`;
    const buffer = new Uint8Array(await blob.arrayBuffer());

    const { error: uploadError } = await supabaseAdmin.storage
      .from(bucket)
      .upload(fileName, buffer, { contentType, upsert: true });

    if (uploadError) {
      console.error(`[upload] audio error for bucket "${bucket}":`, uploadError.message);
      return c.json({ error: { message: uploadError.message } }, 500);
    }

    const { data: urlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(fileName);
    return c.json({ data: { url: urlData.publicUrl } });
  } catch (err: any) {
    console.error("[upload] audio unexpected error:", err?.message ?? err);
    return c.json({ error: { message: err?.message ?? "Upload failed" } }, 500);
  }
}

uploadRouter.post("/avatar", async (c) => handleUpload(c, "Avatars", "avatar"));
uploadRouter.post("/cover", async (c) => handleUpload(c, "Covers", "cover"));
uploadRouter.post("/image", async (c) => handleUpload(c, "Posts", "post"));
uploadRouter.post("/post", async (c) => handleUpload(c, "Posts", "post", { allowVideo: true }));
uploadRouter.post("/audio", async (c) => handleAudioUpload(c, "Posts", "audio"));

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
