import { supabaseAdmin } from "../../supabase";

export const settingsRepository = {
  async getAll() {
    const { data, error } = await supabaseAdmin
      .from("app_settings")
      .select("key, value, updated_at, updated_by")
      .order("key", { ascending: true });
    if (error) throw error;
    return (data ?? []) as {
      key: string;
      value: Record<string, unknown>;
      updated_at?: string;
      updated_by?: string | null;
    }[];
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
