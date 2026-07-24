import { supabaseAdmin } from "../../supabase";

export const contentRepository = {
  async list() {
    const { data, error } = await supabaseAdmin
      .from("app_content")
      .select("*")
      .order("slug", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async getBySlug(slug: string) {
    const { data, error } = await supabaseAdmin
      .from("app_content")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async update(
    slug: string,
    patch: { title?: string; body?: string; is_published?: boolean },
    updatedBy?: string
  ) {
    const { data, error } = await supabaseAdmin
      .from("app_content")
      .update({
        ...patch,
        updated_by: updatedBy ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("slug", slug)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },
};
