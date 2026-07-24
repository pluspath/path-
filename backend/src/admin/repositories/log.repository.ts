import { supabaseAdmin } from "../../supabase";
import type { LogCategory } from "../types";

export type LogInsert = {
  category: LogCategory;
  action: string;
  actor_type?: string;
  actor_id?: string | null;
  actor_name?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  metadata?: Record<string, unknown>;
  ip_address?: string | null;
  user_agent?: string | null;
};

export const logRepository = {
  async create(entry: LogInsert): Promise<void> {
    const { error } = await supabaseAdmin.from("admin_logs").insert({
      category: entry.category,
      action: entry.action,
      actor_type: entry.actor_type ?? "system",
      actor_id: entry.actor_id ?? null,
      actor_name: entry.actor_name ?? null,
      target_type: entry.target_type ?? null,
      target_id: entry.target_id ?? null,
      metadata: entry.metadata ?? {},
      ip_address: entry.ip_address ?? null,
      user_agent: entry.user_agent ?? null,
    });
    if (error) {
      console.error("[admin-logs] failed to persist log:", error.message);
    }
  },

  async list(opts: {
    category?: string;
    search?: string;
    limit: number;
    offset: number;
  }) {
    let query = supabaseAdmin
      .from("admin_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);

    if (opts.category) {
      query = query.eq("category", opts.category);
    }
    if (opts.search) {
      query = query.or(`action.ilike.%${opts.search}%,actor_name.ilike.%${opts.search}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { items: data ?? [], total: count ?? 0 };
  },
};
