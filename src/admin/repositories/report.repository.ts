import { supabaseAdmin } from "../../supabase";

export const reportRepository = {
  async list(opts: { status?: string; limit: number; offset: number; search?: string }) {
    let query = supabaseAdmin
      .from("reports")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);

    if (opts.status) query = query.eq("status", opts.status);
    if (opts.search) {
      query = query.or(`reason.ilike.%${opts.search}%,details.ilike.%${opts.search}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { items: data ?? [], total: count ?? 0 };
  },

  async create(input: {
    reporter_user_id?: string | null;
    target_type: string;
    target_id: string;
    reason: string;
    details?: string;
  }) {
    const { data, error } = await supabaseAdmin
      .from("reports")
      .insert({
        reporter_user_id: input.reporter_user_id ?? null,
        target_type: input.target_type,
        target_id: input.target_id,
        reason: input.reason,
        details: input.details ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async update(
    id: string,
    patch: {
      status?: string;
      resolution_note?: string;
      resolved_by?: string;
      resolved_at?: string;
    }
  ) {
    const { data, error } = await supabaseAdmin
      .from("reports")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id: string) {
    const { error } = await supabaseAdmin.from("reports").delete().eq("id", id);
    if (error) throw error;
  },
};
