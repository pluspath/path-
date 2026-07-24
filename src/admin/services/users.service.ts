import { supabaseAdmin } from "../../supabase";
import { dataRepository } from "../repositories/data.repository";
import { logRepository } from "../repositories/log.repository";
import { toCsv, toPaginated } from "../utils/pagination";
import { sanitizeText } from "../utils/sanitize";

export const usersService = {
  async list(opts: { page: number; limit: number; offset: number; search?: string; status?: string }) {
    const { items, total } = await dataRepository.listProfiles(opts);
    const enriched = await Promise.all(
      items.map(async (p: any) => {
        const [posts, friends] = await Promise.all([
          supabaseAdmin
            .from("posts")
            .select("id", { count: "exact", head: true })
            .eq("user_id", p.id)
            .then((r) => r.count ?? 0),
          supabaseAdmin
            .from("friendships")
            .select("id", { count: "exact", head: true })
            .eq("status", "accepted")
            .or(`requester_id.eq.${p.id},receiver_id.eq.${p.id}`)
            .then((r) => r.count ?? 0),
        ]);
        let email: string | null = null;
        try {
          const { data } = await supabaseAdmin.auth.admin.getUserById(p.id);
          email = data.user?.email ?? null;
        } catch {
          email = null;
        }
        return { ...p, email, postCount: posts, friendCount: friends };
      })
    );
    return toPaginated(enriched, total, opts.page, opts.limit);
  },

  async get(id: string) {
    const profile = await dataRepository.getProfile(id);
    if (!profile) return null;
    let authUser: any = null;
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(id);
      authUser = data.user;
    } catch {
      authUser = null;
    }
    const [{ count: postCount }, { count: friendCount }, { data: recentPosts }] = await Promise.all([
      supabaseAdmin.from("posts").select("id", { count: "exact", head: true }).eq("user_id", id),
      supabaseAdmin
        .from("friendships")
        .select("id", { count: "exact", head: true })
        .eq("status", "accepted")
        .or(`requester_id.eq.${id},receiver_id.eq.${id}`),
      supabaseAdmin
        .from("posts")
        .select("id, type, content, created_at, is_hidden")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    return {
      profile,
      email: authUser?.email ?? null,
      emailConfirmed: !!authUser?.email_confirmed_at,
      banned: !!authUser?.banned_until,
      postCount: postCount ?? 0,
      friendCount: friendCount ?? 0,
      recentPosts: recentPosts ?? [],
    };
  },

  async update(id: string, patch: Record<string, unknown>, actor: { id: string; name: string }) {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      clean[k] = typeof v === "string" ? sanitizeText(v) : v;
    }
    if (clean.status === "suspended") {
      clean.suspended_at = new Date().toISOString();
    }
    if (clean.status === "active") {
      clean.suspended_at = null;
      clean.suspended_reason = null;
    }
    const updated = await dataRepository.updateProfile(id, clean);
    await logRepository.create({
      category: "admin_activity",
      action: "user_update",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "user",
      target_id: id,
      metadata: { fields: Object.keys(clean) },
    });
    return updated;
  },

  async suspend(id: string, reason: string | undefined, actor: { id: string; name: string }) {
    return this.update(
      id,
      { status: "suspended", suspended_reason: reason ?? "Suspended by admin" },
      actor
    );
  },

  async activate(id: string, actor: { id: string; name: string }) {
    return this.update(id, { status: "active" }, actor);
  },

  async delete(id: string, actor: { id: string; name: string }) {
    try {
      await supabaseAdmin.auth.admin.deleteUser(id);
    } catch (e) {
      console.warn("[admin] auth deleteUser failed, deleting profile only", e);
    }
    await dataRepository.deleteProfile(id);
    await logRepository.create({
      category: "admin_activity",
      action: "user_delete",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "user",
      target_id: id,
    });
  },

  async resetPassword(id: string, newPassword: string, actor: { id: string; name: string }) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { password: newPassword });
    if (error) throw error;
    await logRepository.create({
      category: "admin_activity",
      action: "user_reset_password",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "user",
      target_id: id,
    });
  },

  async verifyEmail(id: string, actor: { id: string; name: string }) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(id, {
      email_confirm: true,
    });
    if (error) throw error;
    await logRepository.create({
      category: "admin_activity",
      action: "user_verify_email",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "user",
      target_id: id,
    });
  },

  async exportCsv(opts: { search?: string; status?: string }) {
    const { items } = await dataRepository.listProfiles({
      search: opts.search,
      status: opts.status,
      limit: 5000,
      offset: 0,
    });
    return toCsv(
      items.map((p: any) => ({
        id: p.id,
        username: p.username,
        full_name: p.full_name,
        location: p.location ?? "",
        status: p.status ?? "active",
        created_at: p.created_at,
      }))
    );
  },

  async activity(id: string) {
    const { items } = await logRepository.list({
      search: id,
      limit: 50,
      offset: 0,
    });
    const filtered = items.filter(
      (l: any) => l.target_id === id || l.actor_id === id
    );
    return filtered;
  },
};
