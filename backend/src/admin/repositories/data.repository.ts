import { supabaseAdmin } from "../../supabase";

export const dataRepository = {
  // ---- Profiles / Users ----
  async listProfiles(opts: {
    search?: string;
    status?: string;
    limit: number;
    offset: number;
  }) {
    let query = supabaseAdmin
      .from("profiles")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);

    if (opts.status) query = query.eq("status", opts.status);
    if (opts.search) {
      query = query.or(
        `username.ilike.%${opts.search}%,full_name.ilike.%${opts.search}%,location.ilike.%${opts.search}%`
      );
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { items: data ?? [], total: count ?? 0 };
  },

  async getProfile(id: string) {
    const { data, error } = await supabaseAdmin.from("profiles").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },

  async updateProfile(id: string, patch: Record<string, unknown>) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async deleteProfile(id: string) {
    const { error } = await supabaseAdmin.from("profiles").delete().eq("id", id);
    if (error) throw error;
  },

  async countProfiles(filter?: { status?: string; since?: string }) {
    let query = supabaseAdmin.from("profiles").select("id", { count: "exact", head: true });
    if (filter?.status) query = query.eq("status", filter.status);
    if (filter?.since) query = query.gte("created_at", filter.since);
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  },

  async latestProfiles(limit = 10) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, username, full_name, avatar_url, created_at, status")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },

  // ---- Posts ----
  async listPosts(opts: {
    search?: string;
    type?: string;
    hidden?: boolean;
    published?: boolean;
    limit: number;
    offset: number;
  }) {
    let query = supabaseAdmin
      .from("posts")
      .select("*, profiles(id, username, full_name, avatar_url)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);

    if (opts.type) query = query.eq("type", opts.type);
    if (opts.hidden !== undefined) query = query.eq("is_hidden", opts.hidden);
    if (opts.published !== undefined) query = query.eq("is_published", opts.published);
    if (opts.search) {
      query = query.or(`content.ilike.%${opts.search}%,location.ilike.%${opts.search}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { items: data ?? [], total: count ?? 0 };
  },

  async getPost(id: string) {
    const { data, error } = await supabaseAdmin
      .from("posts")
      .select("*, profiles(id, username, full_name, avatar_url)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async createPost(row: Record<string, unknown>) {
    const { data, error } = await supabaseAdmin.from("posts").insert(row).select("*").single();
    if (error) throw error;
    return data;
  },

  async updatePost(id: string, patch: Record<string, unknown>) {
    const { data, error } = await supabaseAdmin
      .from("posts")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async deletePost(id: string) {
    const { error } = await supabaseAdmin.from("posts").delete().eq("id", id);
    if (error) throw error;
  },

  async countPosts() {
    const { count, error } = await supabaseAdmin
      .from("posts")
      .select("id", { count: "exact", head: true });
    if (error) throw error;
    return count ?? 0;
  },

  // ---- Comments ----
  async listComments(opts: {
    search?: string;
    status?: string;
    limit: number;
    offset: number;
  }) {
    let query = supabaseAdmin
      .from("comments")
      .select("*, profiles(id, username, full_name, avatar_url)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);

    if (opts.status) query = query.eq("moderation_status", opts.status);
    if (opts.search) query = query.ilike("content", `%${opts.search}%`);

    const { data, error, count } = await query;
    if (error) throw error;
    return { items: data ?? [], total: count ?? 0 };
  },

  async updateComment(id: string, patch: Record<string, unknown>) {
    const { data, error } = await supabaseAdmin
      .from("comments")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async deleteComment(id: string) {
    const { error } = await supabaseAdmin.from("comments").delete().eq("id", id);
    if (error) throw error;
  },

  async countComments() {
    const { count, error } = await supabaseAdmin
      .from("comments")
      .select("id", { count: "exact", head: true });
    if (error) throw error;
    return count ?? 0;
  },

  async countReactions() {
    const { count, error } = await supabaseAdmin
      .from("reactions")
      .select("id", { count: "exact", head: true });
    if (error) throw error;
    return count ?? 0;
  },

  // ---- Friendships ----
  async listFriendships(opts: {
    status?: string;
    search?: string;
    limit: number;
    offset: number;
  }) {
    let query = supabaseAdmin
      .from("friendships")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);

    if (opts.status) query = query.eq("status", opts.status);

    const { data, error, count } = await query;
    if (error) throw error;
    return { items: data ?? [], total: count ?? 0 };
  },

  async updateFriendship(id: string, patch: Record<string, unknown>) {
    const { data, error } = await supabaseAdmin
      .from("friendships")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async deleteFriendship(id: string) {
    const { error } = await supabaseAdmin.from("friendships").delete().eq("id", id);
    if (error) throw error;
  },

  async countFriendships(status?: string) {
    let query = supabaseAdmin.from("friendships").select("id", { count: "exact", head: true });
    if (status) query = query.eq("status", status);
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  },

  // ---- Notifications ----
  async listNotifications(opts: { limit: number; offset: number }) {
    const { data, error, count } = await supabaseAdmin
      .from("notifications")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);
    if (error) throw error;
    return { items: data ?? [], total: count ?? 0 };
  },

  async countNotifications() {
    const { count, error } = await supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true });
    if (error) throw error;
    return count ?? 0;
  },

  async insertNotifications(
    rows: Array<{
      user_id: string;
      type: string;
      message: string;
      from_user_id?: string | null;
      post_id?: string | null;
      read?: boolean;
    }>
  ) {
    const { data, error } = await supabaseAdmin.from("notifications").insert(rows).select("*");
    if (error) throw error;
    return data ?? [];
  },

  async getAllProfileIds() {
    const { data, error } = await supabaseAdmin.from("profiles").select("id, push_token");
    if (error) throw error;
    return data ?? [];
  },

  async getProfilesByIds(ids: string[]) {
    if (ids.length === 0) return [];
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, push_token, username, full_name")
      .in("id", ids);
    if (error) throw error;
    return data ?? [];
  },

  // ---- Charts helpers ----
  async registrationsByDay(days: number) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("created_at")
      .gte("created_at", since.toISOString());
    if (error) throw error;

    const buckets: Record<string, number> = {};
    for (let i = 0; i <= days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (days - i));
      buckets[d.toISOString().slice(0, 10)] = 0;
    }
    for (const row of data ?? []) {
      const key = String(row.created_at).slice(0, 10);
      if (key in buckets) buckets[key] = (buckets[key] ?? 0) + 1;
    }
    return Object.entries(buckets).map(([date, count]) => ({ date, count }));
  },

  async postsByDay(days: number) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const { data, error } = await supabaseAdmin
      .from("posts")
      .select("created_at")
      .gte("created_at", since.toISOString());
    if (error) throw error;

    const buckets: Record<string, number> = {};
    for (let i = 0; i <= days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (days - i));
      buckets[d.toISOString().slice(0, 10)] = 0;
    }
    for (const row of data ?? []) {
      const key = String(row.created_at).slice(0, 10);
      if (key in buckets) buckets[key] = (buckets[key] ?? 0) + 1;
    }
    return Object.entries(buckets).map(([date, count]) => ({ date, count }));
  },
};
