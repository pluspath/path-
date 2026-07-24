import { dataRepository } from "../repositories/data.repository";
import { reportRepository } from "../repositories/report.repository";
import { logRepository } from "../repositories/log.repository";
import { toPaginated } from "../utils/pagination";
import { sanitizeText } from "../utils/sanitize";

type Actor = { id: string; name: string };

export const commentsService = {
  async list(opts: {
    page: number;
    limit: number;
    offset: number;
    search?: string;
    status?: string;
  }) {
    const { items, total } = await dataRepository.listComments(opts);
    return toPaginated(items, total, opts.page, opts.limit);
  },

  async approve(id: string, actor: Actor) {
    const updated = await dataRepository.updateComment(id, { moderation_status: "approved" });
    await this.log(actor, "comment_approve", id);
    return updated;
  },

  async reject(id: string, actor: Actor) {
    const updated = await dataRepository.updateComment(id, { moderation_status: "rejected" });
    await this.log(actor, "comment_reject", id);
    return updated;
  },

  async reply(id: string, reply: string, actor: Actor) {
    const updated = await dataRepository.updateComment(id, {
      admin_reply: sanitizeText(reply, 2000),
    });
    await this.log(actor, "comment_reply", id);
    return updated;
  },

  async reportAbuse(id: string, reason: string, actor: Actor) {
    const report = await reportRepository.create({
      target_type: "comment",
      target_id: id,
      reason: sanitizeText(reason, 500),
      reporter_user_id: null,
    });
    try {
      const current = await supabaseSelectReported(id);
      await dataRepository.updateComment(id, { reported_count: current + 1 });
    } catch {
      /* ignore if column missing before migration */
    }
    await this.log(actor, "comment_report", id, { reportId: report.id });
    return { report };
  },

  async delete(id: string, actor: Actor) {
    await dataRepository.deleteComment(id);
    await this.log(actor, "comment_delete", id);
  },

  async update(id: string, patch: Record<string, unknown>, actor: Actor) {
    if (typeof patch.content === "string") patch.content = sanitizeText(patch.content);
    if (typeof patch.admin_reply === "string") patch.admin_reply = sanitizeText(patch.admin_reply);
    const updated = await dataRepository.updateComment(id, patch);
    await this.log(actor, "comment_update", id);
    return updated;
  },

  async log(actor: Actor, action: string, id: string, metadata?: Record<string, unknown>) {
    await logRepository.create({
      category: "admin_activity",
      action,
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "comment",
      target_id: id,
      metadata,
    });
  },
};

async function supabaseSelectReported(id: string): Promise<number> {
  const { supabaseAdmin } = await import("../../supabase");
  const { data } = await supabaseAdmin.from("comments").select("reported_count").eq("id", id).maybeSingle();
  return Number(data?.reported_count ?? 0);
}
