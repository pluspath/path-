/**
 * Upload website-dist/*.html to a public Supabase Storage bucket.
 * Usage: bun run scripts/upload-marketing-storage.ts
 */
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { env } from "../src/env";

const dir = resolve(import.meta.dir, "../website-dist");
const bucket = "marketing";
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY required");
  }

  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw listErr;

  if (!buckets?.some((b) => b.name === bucket)) {
    const { error } = await supabase.storage.createBucket(bucket, {
      public: true,
      fileSizeLimit: 2_000_000,
    });
    if (error) throw error;
    console.log("created public bucket:", bucket);
  } else {
    // Ensure HTML uploads are allowed on existing buckets
    await supabase.storage.updateBucket(bucket, {
      public: true,
      fileSizeLimit: 2_000_000,
    });
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".html"));
  for (const name of files) {
    const html = readFileSync(resolve(dir, name), "utf8");
    // Delete then re-upload so Content-Type metadata is applied cleanly
    await supabase.storage.from(bucket).remove([name]);
    const blob = new Blob([html], { type: "text/html" });
    const { error } = await supabase.storage.from(bucket).upload(name, blob, {
      upsert: true,
      contentType: "text/html",
      cacheControl: "60",
    });
    if (error) throw error;
    const { data } = supabase.storage.from(bucket).getPublicUrl(name);
    console.log(data.publicUrl);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
