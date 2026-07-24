import { supabaseAdmin } from "../../supabase";

export const settingsRepository = {
  async getAll() {
    const { data, error } = await supabaseAdmin.from("app_settings").select("*");
    if (error) throw error;
    const map: Record<string, unknown> = {};
    for (const row of data ?? []) {
      map[row.key] = row.value;
    }
    return map;
  },

  async get(key: string) {
    const { data, error } = await supabaseAdmin
      .from("app_settings")
      .select("*")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async upsert(key: string, value: unknown, updatedBy?: string) {
    const { data, error } = await supabaseAdmin
      .from("app_settings")
      .upsert({
        key,
        value,
        updated_by: updatedBy ?? null,
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },
};
