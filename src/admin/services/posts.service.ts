import { decodeImages } from "../../lib/images";
import { dataRepository } from "../repositories/data.repository";
import { logRepository } from "../repositories/log.repository";
import { toPaginated } from "../utils/pagination";
import { sanitizeText } from "../utils/sanitize";

type Actor = { id: string; name: string };

function mediaTypeFromUrl(url: string): "image" | "video" {
  const lower = url.toLowerCase().split("?")[0] ?? "";
  if (/\.(mp4|mov|webm|m4v|avi|mkv)$/.test(lower)) return "video";
  return "image";
}

function enrichPostMedia(post: Record<string, any>) {
  const urls = decodeImages(post.image_url);
  const media = urls.map((url, index) => ({
    index,
    url,
    type: mediaTypeFromUrl(url),
  }));
  const hasVideo = media.some((m) => m.type === "video");
  const hasImage = media.some((m) => m.type === "image");
  let mediaKind: "text" | "image" | "video" | "mixed" = "text";
  if (hasVideo && hasImage) mediaKind = "mixed";
  else if (hasVideo) mediaKind = "video";
  else if (hasImage) mediaKind = "image";
  return {
    ...post,
    media,
    mediaCount: media.length,
    mediaKind,
  };
}

export const postsService = {
  async list(opts: {
    page: number;
    limit: number;
    offset: number;
    search?: string;
    type?: string;
    hidden?: boolean;
    published?: boolean;
  }) {
    const { items, total } = await dataRepository.listPosts(opts);
    return toPaginated(
      (items as any[]).map((row) => enrichPostMedia(row)),
      total,
      opts.page,
      opts.limit
    );
  },

  async get(id: string) {
    const post = await dataRepository.getPost(id);
    if (!post) return null;
    const enriched = enrichPostMedia(post as any);
    const [comments, reactionCount, viewCount, reportCount, reports] = await Promise.all([
      dataRepository.listComments({ postId: id, limit: 100, offset: 0 }),
      dataRepository.countReactionsForPost(id).catch(() => 0),
      dataRepository.countViewsForPost(id).catch(() => 0),
      dataRepository.countReportsForTarget("post", id).catch(() => 0),
      dataRepository.listReportsForTarget("post", id, 20).catch(() => []),
    ]);
    return {
      ...enriched,
      reactionCount,
      viewCount,
      reportCount,
      reports,
      comments: comments.items,
      commentTotal: comments.total,
    };
  },

  async create(input: Record<string, unknown>, actor: Actor) {
    const row = {
      ...input,
      content: typeof input.content === "string" ? sanitizeText(input.content) : input.content,
      is_hidden: input.is_hidden ?? false,
      is_published: input.is_published ?? true,
    };
    const created = await dataRepository.createPost(row);
    await logRepository.create({
      category: "admin_activity",
      action: "post_create",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "post",
      target_id: created.id,
    });
    return enrichPostMedia(created as any);
  },

  async update(id: string, patch: Record<string, unknown>, actor: Actor) {
    const existing = await dataRepository.getPost(id);
    const clean = { ...patch };
    if (typeof clean.content === "string") clean.content = sanitizeText(clean.content);
    const updated = await dataRepository.updatePost(id, clean);
    await logRepository.create({
      category: "admin_activity",
      action: "post_update",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "post",
      target_id: id,
      metadata: {
        fields: Object.keys(clean),
        previous: existing
          ? {
              is_hidden: (existing as any).is_hidden,
              is_published: (existing as any).is_published,
            }
          : undefined,
        next: {
          is_hidden: (updated as any).is_hidden,
          is_published: (updated as any).is_published,
        },
      },
    });
    return enrichPostMedia(updated as any);
  },

  async hide(id: string, actor: Actor) {
    const existing = await dataRepository.getPost(id);
    const updated = await dataRepository.updatePost(id, { is_hidden: true });
    await logRepository.create({
      category: "admin_activity",
      action: "post_disable",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "post",
      target_id: id,
      metadata: {
        previous_status: { is_hidden: (existing as any)?.is_hidden ?? null },
        new_status: { is_hidden: true },
      },
    });
    return enrichPostMedia(updated as any);
  },

  async unhide(id: string, actor: Actor) {
    const existing = await dataRepository.getPost(id);
    const updated = await dataRepository.updatePost(id, { is_hidden: false });
    await logRepository.create({
      category: "admin_activity",
      action: "post_restore",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "post",
      target_id: id,
      metadata: {
        previous_status: { is_hidden: (existing as any)?.is_hidden ?? null },
        new_status: { is_hidden: false },
      },
    });
    return enrichPostMedia(updated as any);
  },

  async publish(id: string, actor: Actor) {
    return this.update(id, { is_published: true, is_hidden: false }, actor);
  },

  async unpublish(id: string, actor: Actor) {
    return this.update(id, { is_published: false }, actor);
  },

  async delete(id: string, actor: Actor) {
    const existing = await dataRepository.getPost(id);
    await dataRepository.deletePost(id);
    await logRepository.create({
      category: "admin_activity",
      action: "post_delete",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "post",
      target_id: id,
      metadata: existing
        ? {
            user_id: (existing as any).user_id,
            type: (existing as any).type,
            was_hidden: (existing as any).is_hidden,
          }
        : undefined,
    });
  },
};
