import { dataRepository } from "../repositories/data.repository";
import { logRepository } from "../repositories/log.repository";
import { toCsv, toPaginated } from "../utils/pagination";

type Actor = { id: string; name: string };

export const friendshipsService = {
  async list(opts: {
    page: number;
    limit: number;
    offset: number;
    status?: string;
    search?: string;
  }) {
    const { items, total } = await dataRepository.listFriendships(opts);
    const userIds = new Set<string>();
    for (const f of items as any[]) {
      if (f.requester_id) userIds.add(f.requester_id);
      if (f.receiver_id) userIds.add(f.receiver_id);
    }
    const profiles = await dataRepository.getProfilesByIds([...userIds]);
    const map = Object.fromEntries(profiles.map((p: any) => [p.id, p]));
    const enriched = (items as any[]).map((f) => ({
      ...f,
      requester: map[f.requester_id] ?? null,
      receiver: map[f.receiver_id] ?? null,
    }));
    return toPaginated(enriched, total, opts.page, opts.limit);
  },

  async confirm(id: string, actor: Actor) {
    const updated = await dataRepository.updateFriendship(id, { status: "accepted" });
    await logRepository.create({
      category: "admin_activity",
      action: "friendship_confirm",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "friendship",
      target_id: id,
    });
    return updated;
  },

  async cancel(id: string, actor: Actor) {
    await dataRepository.deleteFriendship(id);
    await logRepository.create({
      category: "admin_activity",
      action: "friendship_cancel",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "friendship",
      target_id: id,
    });
  },

  async update(id: string, patch: Record<string, unknown>, actor: Actor) {
    const updated = await dataRepository.updateFriendship(id, patch);
    await logRepository.create({
      category: "admin_activity",
      action: "friendship_update",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "friendship",
      target_id: id,
      metadata: patch,
    });
    return updated;
  },

  async exportCsv() {
    const { items } = await dataRepository.listFriendships({ limit: 5000, offset: 0 });
    return toCsv(
      (items as any[]).map((f) => ({
        id: f.id,
        requester_id: f.requester_id,
        receiver_id: f.receiver_id,
        status: f.status,
        created_at: f.created_at,
      }))
    );
  },
};
