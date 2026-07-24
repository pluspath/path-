import { reportRepository } from "../repositories/report.repository";
import { logRepository } from "../repositories/log.repository";
import { toPaginated } from "../utils/pagination";
import { sanitizeText } from "../utils/sanitize";

type Actor = { id: string; name: string };

export const reportsService = {
  async list(opts: {
    page: number;
    limit: number;
    offset: number;
    status?: string;
    search?: string;
  }) {
    const { items, total } = await reportRepository.list(opts);
    return toPaginated(items, total, opts.page, opts.limit);
  },

  async create(input: {
    reporter_user_id?: string;
    target_type: string;
    target_id: string;
    reason: string;
    details?: string;
  }, actor: Actor) {
    const created = await reportRepository.create({
      ...input,
      reason: sanitizeText(input.reason, 500),
      details: input.details ? sanitizeText(input.details, 2000) : undefined,
    });
    await logRepository.create({
      category: "admin_activity",
      action: "report_create",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "report",
      target_id: created.id,
    });
    return created;
  },

  async update(
    id: string,
    patch: { status?: string; resolution_note?: string },
    actor: Actor
  ) {
    const data: Record<string, unknown> = { ...patch };
    if (patch.resolution_note) data.resolution_note = sanitizeText(patch.resolution_note, 2000);
    if (patch.status === "resolved" || patch.status === "dismissed") {
      data.resolved_by = actor.id;
      data.resolved_at = new Date().toISOString();
    }
    const updated = await reportRepository.update(id, data as any);
    await logRepository.create({
      category: "admin_activity",
      action: "report_update",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "report",
      target_id: id,
      metadata: patch,
    });
    return updated;
  },

  async delete(id: string, actor: Actor) {
    await reportRepository.delete(id);
    await logRepository.create({
      category: "admin_activity",
      action: "report_delete",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "report",
      target_id: id,
    });
  },
};
