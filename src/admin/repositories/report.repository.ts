import { supabaseAdmin } from "../../supabase";

export const reportRepository = {
  async list(opts: {
    status?: string;
    targetType?: string;
    limit: number;
    offset: number;
    search?: string;
  }) {
    let query = supabaseAdmin
      .from("reports")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);

    if (opts.status) query = query.eq("status", opts.status);
    if (opts.targetType) query = query.eq("target_type", opts.targetType);
    if (opts.search) {
      const term = opts.search.trim().replace(/[%_,]/g, " ").replace(/\s+/g, " ");
      const uuidLike =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(term);
      if (uuidLike) {
        query = query.or(
          `id.eq.${term},target_id.eq.${term},reporter_user_id.eq.${term},reported_user_id.eq.${term},reported_post_id.eq.${term}`
        );
      } else if (term) {
        query = query.or(`reason.ilike.%${term}%,details.ilike.%${term}%,target_id.ilike.%${term}%`);
      }
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { items: data ?? [], total: count ?? 0 };
  },

  async get(id: string) {
    const { data, error } = await supabaseAdmin.from("reports").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
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
