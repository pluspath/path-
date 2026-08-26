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
  "audio/3gpp",
  "audio/amr",
  "audio/ogg",
]);

/** MIME types the Posts bucket must accept (images + video + chat audio). */
export const POSTS_BUCKET_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/aac",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
  "audio/3gpp",
  "audio/amr",
  "audio/ogg",
];

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

let postsBucketReady: Promise<void> | null = null;

/** Ensure the Posts bucket exists and allows image/video/audio MIME types. */
export async function ensurePostsBucketForChat(): Promise<void> {
  if (!postsBucketReady) {
    postsBucketReady = (async () => {
      try {
        const { data: buckets } = await supabaseAdmin.storage.listBuckets();
        const exists = (buckets ?? []).some((b) => b.id === "Posts" || b.name === "Posts");
        if (!exists) {
          const { error: createErr } = await supabaseAdmin.storage.createBucket("Posts", {
            public: true,
            fileSizeLimit: 52_428_800,
            allowedMimeTypes: POSTS_BUCKET_MIME_TYPES,
          });
          if (createErr) console.warn("[upload] create Posts bucket:", createErr.message);
        }

        // Service-role update of bucket MIME allowlist (critical for audio DMs).
        const { error: updateErr } = await supabaseAdmin.storage.updateBucket("Posts", {
          public: true,
          fileSizeLimit: 52_428_800,
          allowedMimeTypes: POSTS_BUCKET_MIME_TYPES,
        });
        if (updateErr) {
          console.warn("[upload] update Posts bucket MIME list:", updateErr.message);
          // Fallback via SQL when storage API rejects the update.
          await supabaseAdmin.rpc("exec_sql", {
            sql: `UPDATE storage.buckets
              SET file_size_limit = 52428800,
                  allowed_mime_types = ARRAY[${POSTS_BUCKET_MIME_TYPES.map((m) => `'${m}'`).join(",")}]
              WHERE id = 'Posts' OR name = 'Posts';`,
          }).then(({ error }) => {
            if (error) console.warn("[upload] SQL MIME update failed:", error.message);
            else console.log("[upload] Posts bucket MIME list updated via SQL");
          });
        } else {
          console.log("[upload] Posts bucket accepts images, video, and audio");
        }
      } catch (e) {
        console.warn("[upload] ensurePostsBucketForChat:", e instanceof Error ? e.message : e);
      }
    })();
  }
  await postsBucketReady;
}

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
    case "audio/3gpp":
      return "3gp";
    case "audio/ogg":
      return "ogg";
    case "audio/mp4":
    case "audio/m4a":
    case "audio/x-m4a":
      return "m4a";
    default:
      return "jpg";
  }
}

function sniffContentType(rawName: string, fallback: string): string {
  const n = rawName.toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".mov")) return "video/quicktime";
  if (n.endsWith(".webm")) return n.includes("audio") ? "audio/webm" : "video/webm";
  if (n.endsWith(".mp4") || n.endsWith(".m4v")) return "video/mp4";
  if (n.endsWith(".mp3")) return "audio/mpeg";
  if (n.endsWith(".wav")) return "audio/wav";
  if (n.endsWith(".m4a")) return "audio/mp4";
  if (n.endsWith(".aac")) return "audio/aac";
  if (n.endsWith(".3gp")) return "audio/3gpp";
  if (n.endsWith(".ogg") || n.endsWith(".oga")) return "audio/ogg";
  return fallback;
}

async function fileToBuffer(file: any): Promise<Uint8Array> {
  if (!file) throw new Error("No file provided");
  if (file instanceof Uint8Array) return file;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(file)) return new Uint8Array(file);
  if (typeof file.arrayBuffer === "function") {
    return new Uint8Array(await file.arrayBuffer());
  }
  if (typeof file.bytes === "function") {
    return new Uint8Array(await file.bytes());
  }
  // Bun sometimes exposes the raw data as a stream.
  if (typeof file.stream === "function") {
    const reader = file.stream().getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }
  throw new Error("Unsupported upload payload");
}

type ExtractedFile = {
  buffer: Uint8Array;
  contentType: string;
  fileName: string;
};

/**
 * Accept either:
 *  - multipart/form-data with field `file` (React Native FormData)
 *  - application/json { base64, fileName?, contentType? }  (most reliable for RN)
 */
async function extractUpload(c: any, defaultType: string): Promise<ExtractedFile> {
  const contentTypeHeader = (c.req.header("content-type") || "").toLowerCase();

  if (contentTypeHeader.includes("application/json")) {
    const json = await c.req.json();
    const b64 = typeof json.base64 === "string" ? json.base64 : typeof json.data === "string" ? json.data : null;
    if (!b64) throw new Error("Missing base64 field");
    const cleaned = b64.replace(/^data:[^;]+;base64,/, "");
    const buffer = Uint8Array.from(Buffer.from(cleaned, "base64"));
    const fileName = typeof json.fileName === "string" ? json.fileName : `upload.${extensionFor(defaultType)}`;
    let contentType = (typeof json.contentType === "string" ? json.contentType : "").toLowerCase();
    if (!contentType || contentType === "application/octet-stream") {
      contentType = sniffContentType(fileName, defaultType);
    }
    return { buffer, contentType, fileName };
  }

  // Multipart — try parseBody, then raw FormData.
  let file: any = null;
  try {
    const body = await c.req.parseBody({ all: true });
    file = body["file"] ?? body["image"] ?? body["audio"];
    if (Array.isArray(file)) file = file[0];
  } catch (e) {
    console.warn("[upload] parseBody failed, trying formData:", e instanceof Error ? e.message : e);
  }

  if (!file || typeof file === "string") {
    try {
      const form = await c.req.formData();
      file = form.get("file") ?? form.get("image") ?? form.get("audio");
    } catch {
      /* ignore */
    }
  }

  if (!file || typeof file === "string") {
    throw new Error("No file provided");
  }

  const rawName = file.name ? String(file.name) : `upload.${extensionFor(defaultType)}`;
  let contentType = (file.type || "").toLowerCase();
  if (!contentType || contentType === "application/octet-stream") {
    contentType = sniffContentType(rawName, defaultType);
  }
  const buffer = await fileToBuffer(file);
  return { buffer, contentType, fileName: rawName };
}

async function storeInBucket(
  bucket: string,
  userId: string,
  prefix: string,
  extracted: ExtractedFile,
  maxBytes: number,
  allowed: Set<string>
) {
  if (bucket === "Posts") {
    await ensurePostsBucketForChat();
  }

  if (!allowed.has(extracted.contentType)) {
    throw Object.assign(new Error(`Unsupported file type: ${extracted.contentType}`), { status: 400 });
  }
  if (extracted.buffer.byteLength > maxBytes) {
    throw Object.assign(
      new Error(`File too large (max ${Math.round(maxBytes / (1024 * 1024))}MB)`),
      { status: 400 }
    );
  }
  if (extracted.buffer.byteLength === 0) {
    throw Object.assign(new Error("Empty file"), { status: 400 });
  }

  const ext = extensionFor(extracted.contentType);
  const fileName = `${prefix}/${userId}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(fileName, extracted.buffer, {
      contentType: extracted.contentType,
      upsert: true,
    });

  if (uploadError) {
    if (bucket === "Posts" && /mime|not supported|invalid/i.test(uploadError.message)) {
      console.warn("[upload] MIME rejected, widening Posts allowlist and retrying:", uploadError.message);
      postsBucketReady = null;
      await ensurePostsBucketForChat();
      const retry = await supabaseAdmin.storage
        .from(bucket)
        .upload(fileName, extracted.buffer, {
          contentType: extracted.contentType,
          upsert: true,
        });
      if (retry.error) throw new Error(retry.error.message);
    } else {
      throw new Error(uploadError.message);
    }
  }

  const { data: urlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(fileName);
  if (!urlData.publicUrl) throw new Error("Upload succeeded but public URL missing");
  return urlData.publicUrl;
}

async function handleMediaUpload(
  c: any,
  bucket: string,
  prefix: string,
  opts: { defaultType: string; maxBytes: number; allowed: Set<string> }
) {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const extracted = await extractUpload(c, opts.defaultType);
    const url = await storeInBucket(bucket, userId, prefix, extracted, opts.maxBytes, opts.allowed);
    return c.json({ data: { url } });
  } catch (err: any) {
    const status = err?.status === 400 ? 400 : 500;
    console.error(`[upload] ${prefix} error:`, err?.message ?? err);
    return c.json({ error: { message: err?.message ?? "Upload failed" } }, status);
  }
}

uploadRouter.post("/avatar", async (c) =>
  handleMediaUpload(c, "Avatars", "avatar", {
    defaultType: "image/jpeg",
    maxBytes: MAX_IMAGE_BYTES,
    allowed: ALLOWED_IMAGE_TYPES,
  })
);
uploadRouter.post("/cover", async (c) =>
  handleMediaUpload(c, "Covers", "cover", {
    defaultType: "image/jpeg",
    maxBytes: MAX_IMAGE_BYTES,
    allowed: ALLOWED_IMAGE_TYPES,
  })
);
uploadRouter.post("/image", async (c) =>
  handleMediaUpload(c, "Posts", "post", {
    defaultType: "image/jpeg",
    maxBytes: MAX_IMAGE_BYTES,
    allowed: ALLOWED_IMAGE_TYPES,
  })
);
uploadRouter.post("/post", async (c) =>
  handleMediaUpload(c, "Posts", "post", {
    defaultType: "image/jpeg",
    maxBytes: MAX_VIDEO_BYTES,
    allowed: new Set([...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES]),
  })
);
uploadRouter.post("/audio", async (c) =>
  handleMediaUpload(c, "Posts", "audio", {
    defaultType: "audio/mp4",
    maxBytes: MAX_AUDIO_BYTES,
    allowed: ALLOWED_AUDIO_TYPES,
  })
);

uploadRouter.get("/test-storage", async (c) => {
  await ensurePostsBucketForChat();
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

  const posts = (buckets ?? []).find((b) => b.id === "Posts" || b.name === "Posts");
  return c.json({
    data: {
      connected: true,
      bucketCount: buckets?.length ?? 0,
      postsBucket: posts
        ? {
            id: posts.id,
            public: posts.public,
            allowedMimeTypes: (posts as any).allowed_mime_types ?? null,
            fileSizeLimit: (posts as any).file_size_limit ?? null,
          }
        : null,
      buckets: (buckets ?? []).map((b) => ({ id: b.id, name: b.name, public: b.public })),
    },
  });
});

export { uploadRouter };
