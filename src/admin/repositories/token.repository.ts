import { supabaseAdmin } from "../../supabase";

export const tokenRepository = {
  async deny(jti: string, adminUserId: string, expiresAt: Date): Promise<void> {
    const { error } = await supabaseAdmin.from("admin_token_denylist").upsert({
      jti,
      admin_user_id: adminUserId,
      expires_at: expiresAt.toISOString(),
    });
    if (error) throw error;
  },

  async isDenied(jti: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from("admin_token_denylist")
      .select("jti")
      .eq("jti", jti)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  },

  async createResetToken(adminUserId: string, tokenHash: string, expiresAt: Date) {
    const { data, error } = await supabaseAdmin
      .from("admin_password_resets")
      .insert({
        admin_user_id: adminUserId,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async findValidReset(tokenHash: string) {
    const { data, error } = await supabaseAdmin
      .from("admin_password_resets")
      .select("*")
      .eq("token_hash", tokenHash)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async markResetUsed(id: string) {
    const { error } = await supabaseAdmin
      .from("admin_password_resets")
      .update({ used_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },
};
