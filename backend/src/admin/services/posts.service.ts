import { dataRepository } from "../repositories/data.repository";
import { logRepository } from "../repositories/log.repository";
import { toPaginated } from "../utils/pagination";
import { sanitizeText } from "../utils/sanitize";

type Actor = { id: string; name: string };

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
    return toPaginated(items, total, opts.page, opts.limit);
  },

  async get(id: string) {
    return dataRepository.getPost(id);
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
    return created;
  },

  async update(id: string, patch: Record<string, unknown>, actor: Actor) {
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
      metadata: { fields: Object.keys(clean) },
    });
    return updated;
  },

  async hide(id: string, actor: Actor) {
    return this.update(id, { is_hidden: true }, actor);
  },

  async publish(id: string, actor: Actor) {
    return this.update(id, { is_published: true, is_hidden: false }, actor);
  },

  async unpublish(id: string, actor: Actor) {
    return this.update(id, { is_published: false }, actor);
  },

  async delete(id: string, actor: Actor) {
    await dataRepository.deletePost(id);
    await logRepository.create({
      category: "admin_activity",
      action: "post_delete",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "post",
      target_id: id,
    });
  },
};
