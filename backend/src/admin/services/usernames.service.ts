import { supabaseAdmin } from "../../supabase";
import { logRepository } from "../repositories/log.repository";
import { toPaginated } from "../utils/pagination";
import { sanitizeText } from "../utils/sanitize";

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

function normalizeUsername(raw: string): string {
  return sanitizeText(raw).toLowerCase().trim();
}

export const usernamesService = {
  async list(opts: { page: number; limit: number; offset: number; search?: string }) {
    let q = supabaseAdmin
      .from("profiles")
      .select("id, username, full_name, status, created_at, suspended_at, suspended_reason", {
        count: "exact",
      })
      .order("username", { ascending: true })
      .range(opts.offset, opts.offset + opts.limit - 1);

    const search = opts.search?.trim();
    if (search) {
      q = q.or(`username.ilike.%${search}%,full_name.ilike.%${search}%`);
    }

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);

    const { data: pending } = await supabaseAdmin
      .from("pending_registrations")
      .select("id, email, username, full_name, created_at, expires_at")
      .order("created_at", { ascending: false })
      .limit(100);

    return {
      ...toPaginated(data ?? [], count ?? 0, opts.page, opts.limit),
      pendingRegistrations: pending ?? [],
    };
  },

  async rename(
    userId: string,
    nextUsername: string,
    actor: { id: string; name: string }
  ) {
    const username = normalizeUsername(nextUsername);
    if (!USERNAME_RE.test(username)) {
      throw new Error("Username must be 3–30 characters: letters, numbers, underscore.");
    }

    const { data: taken } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .neq("id", userId)
      .maybeSingle();
    if (taken) throw new Error("That username is already taken.");

    const { data: pending } = await supabaseAdmin
      .from("pending_registrations")
      .select("id")
      .ilike("username", username)
      .maybeSingle();
    if (pending) throw new Error("That username is reserved by a pending signup.");

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update({ username })
      .eq("id", userId)
      .select("id, username, full_name, status")
      .single();
    if (error) throw new Error(error.message);

    await logRepository.create({
      category: "admin_activity",
      action: "username_rename",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "user",
      target_id: userId,
      metadata: { username },
    });

    return data;
  },

  /**
   * Free a username for new signups without deleting the whole account.
   * Renames the profile to a unique released_* slug and clears pending holds.
   */
  async release(usernameRaw: string, actor: { id: string; name: string }) {
    const username = normalizeUsername(usernameRaw);
    if (!username) throw new Error("Username is required");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, username")
      .eq("username", username)
      .maybeSingle();

    let releasedFromProfile: string | null = null;
    if (profile?.id) {
      const placeholder = `released_${profile.id.replace(/-/g, "").slice(0, 16)}`;
      const { error } = await supabaseAdmin
        .from("profiles")
        .update({ username: placeholder })
        .eq("id", profile.id);
      if (error) throw new Error(error.message);
      releasedFromProfile = profile.id;
    }

    const { data: clearedPending } = await supabaseAdmin
      .from("pending_registrations")
      .delete()
      .ilike("username", username)
      .select("id");

    await logRepository.create({
      category: "admin_activity",
      action: "username_release",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "username",
      target_id: username,
      metadata: {
        releasedFromProfile,
        clearedPendingCount: clearedPending?.length ?? 0,
      },
    });

    return {
      username,
      releasedFromProfile,
      clearedPendingCount: clearedPending?.length ?? 0,
    };
  },

  async clearPending(id: string, actor: { id: string; name: string }) {
    const { data, error } = await supabaseAdmin
      .from("pending_registrations")
      .delete()
      .eq("id", id)
      .select("id, username, email")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Pending registration not found");

    await logRepository.create({
      category: "admin_activity",
      action: "username_clear_pending",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "pending_registration",
      target_id: id,
      metadata: { username: data.username, email: data.email },
    });

    return data;
  },
};
