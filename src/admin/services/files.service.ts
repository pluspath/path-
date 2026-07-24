import { supabaseAdmin } from "../../supabase";
import { logRepository } from "../repositories/log.repository";

type Actor = { id: string; name: string };

const BUCKETS = ["Avatars", "Covers"] as const;

export const filesService = {
  buckets() {
    return BUCKETS;
  },

  async list(bucket: string, path = "", search?: string) {
    if (!(BUCKETS as readonly string[]).includes(bucket)) {
      throw new Error("Invalid bucket");
    }
    const { data, error } = await supabaseAdmin.storage.from(bucket).list(path || "", {
      limit: 200,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (error) throw error;
    let items = data ?? [];
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((f) => f.name.toLowerCase().includes(q));
    }
    return items.map((f) => {
      const fullPath = path ? `${path}/${f.name}` : f.name;
      const { data: pub } = supabaseAdmin.storage.from(bucket).getPublicUrl(fullPath);
      return {
        name: f.name,
        id: f.id,
        updated_at: f.updated_at,
        created_at: f.created_at,
        metadata: f.metadata,
        path: fullPath,
        bucket,
        publicUrl: pub.publicUrl,
        isFolder: !f.id && !f.metadata,
      };
    });
  },

  async delete(bucket: string, paths: string[], actor: Actor) {
    if (!(BUCKETS as readonly string[]).includes(bucket)) {
      throw new Error("Invalid bucket");
    }
    const { error } = await supabaseAdmin.storage.from(bucket).remove(paths);
    if (error) throw error;
    await logRepository.create({
      category: "admin_activity",
      action: "file_delete",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      metadata: { bucket, paths },
    });
  },

  async replace(bucket: string, path: string, file: File, actor: Actor) {
    if (!(BUCKETS as readonly string[]).includes(bucket)) {
      throw new Error("Invalid bucket");
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error } = await supabaseAdmin.storage.from(bucket).upload(path, buffer, {
      upsert: true,
      contentType: file.type || "application/octet-stream",
    });
    if (error) throw error;
    const { data: pub } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
    await logRepository.create({
      category: "admin_activity",
      action: "file_replace",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      metadata: { bucket, path },
    });
    return { path, publicUrl: pub.publicUrl };
  },
};
