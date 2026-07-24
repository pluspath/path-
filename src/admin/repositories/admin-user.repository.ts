import { supabaseAdmin } from "../../supabase";
import type { AdminRole } from "../constants";
import type { AdminUser } from "../types";

export const adminUserRepository = {
  async findByUsername(username: string): Promise<AdminUser | null> {
    const { data, error } = await supabaseAdmin
      .from("admin_users")
      .select("*")
      .eq("username", username)
      .maybeSingle();
    if (error) throw error;
    return data as AdminUser | null;
  },

  async findById(id: string): Promise<AdminUser | null> {
    const { data, error } = await supabaseAdmin
      .from("admin_users")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data as AdminUser | null;
  },

  async list(): Promise<AdminUser[]> {
    const { data, error } = await supabaseAdmin
      .from("admin_users")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as AdminUser[];
  },

  async create(input: {
    username: string;
    password_hash: string;
    role: AdminRole;
    display_name?: string;
    email?: string;
  }): Promise<AdminUser> {
    const { data, error } = await supabaseAdmin
      .from("admin_users")
      .insert({
        username: input.username,
        password_hash: input.password_hash,
        role: input.role,
        display_name: input.display_name ?? null,
        email: input.email ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as AdminUser;
  },

  async update(
    id: string,
    patch: Partial<{
      password_hash: string;
      role: AdminRole;
      display_name: string | null;
      email: string | null;
      is_active: boolean;
      last_login_at: string;
      password_changed_at: string;
      updated_at: string;
    }>
  ): Promise<AdminUser> {
    const { data, error } = await supabaseAdmin
      .from("admin_users")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data as AdminUser;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabaseAdmin.from("admin_users").delete().eq("id", id);
    if (error) throw error;
  },

  async ensureDefaultAdmin(passwordHash: string): Promise<void> {
    const existing = await this.findByUsername("admin");
    if (existing) return;
    await this.create({
      username: "admin",
      password_hash: passwordHash,
      role: "super_admin",
      display_name: "Path+ Administrator",
      email: "admin@pathplus.app",
    });
  },
};
