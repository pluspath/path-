import { supabaseAdmin } from "../supabase";
import {
  sendAccountDeletionEmail,
  sendAccountDeletionReminderEmail,
} from "./email-service";

export const DELETION_SUSPEND_REASON = "account_deletion";
/** User may log in and cancel deletion within this window (days). */
export const DELETION_GRACE_DAYS = 30;
/** Reminder email goes out on this day of the grace window (0-indexed from suspend). */
export const DELETION_REMINDER_DAY = 29;
/** Permanent purge after the full 30-day grace window (no login). */
export const DELETION_PURGE_AFTER_DAYS = DELETION_GRACE_DAYS;

const MS_PER_DAY = 86_400_000;

export function daysSince(iso: string | null | undefined): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / MS_PER_DAY;
}

/** True while the user can still sign in to cancel deletion (days 0–29). */
export function isDeletionGracePeriod(suspendedAt: string | null | undefined): boolean {
  return daysSince(suspendedAt) < DELETION_GRACE_DAYS;
}

export function shouldSendDeletionReminder(suspendedAt: string | null | undefined): boolean {
  const d = daysSince(suspendedAt);
  return d >= DELETION_REMINDER_DAY && d < DELETION_GRACE_DAYS;
}

export function shouldPurgeDeletionAccount(suspendedAt: string | null | undefined): boolean {
  return daysSince(suspendedAt) >= DELETION_PURGE_AFTER_DAYS;
}

/** Profile is in the deletion grace window — content must be hidden; username stays reserved. */
export function isDeletionHiddenProfile(profile: {
  status?: string | null;
  suspended_reason?: string | null;
} | null | undefined): boolean {
  return (
    profile?.status === "suspended" &&
    profile?.suspended_reason === DELETION_SUSPEND_REASON
  );
}

/** User ids whose posts/moments must be hidden from everyone during the grace window. */
const DELETION_HIDDEN_TTL_MS = 30_000;
let deletionHiddenCache: { ids: Set<string>; expires: number } | null = null;

export function invalidateDeletionHiddenUserIdsCache(): void {
  deletionHiddenCache = null;
}

export async function getDeletionHiddenUserIds(): Promise<Set<string>> {
  if (deletionHiddenCache && deletionHiddenCache.expires > Date.now()) {
    return deletionHiddenCache.ids;
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("status", "suspended")
    .eq("suspended_reason", DELETION_SUSPEND_REASON);

  if (error) {
    console.warn("[account-deletion] hidden-ids lookup failed:", error.message);
    return deletionHiddenCache?.ids ?? new Set();
  }

  const ids = new Set((data ?? []).map((r: { id: string }) => r.id));
  deletionHiddenCache = { ids, expires: Date.now() + DELETION_HIDDEN_TTL_MS };
  return ids;
}

/** Drop posts authored by deletion-suspended users (and their nested originals). */
export function filterDeletionHiddenPosts<T extends { user_id?: string; original?: { user_id?: string } | null }>(
  posts: T[],
  hiddenIds: Set<string>,
  viewerId?: string | null
): T[] {
  if (hiddenIds.size === 0) return posts;
  return posts.filter((p) => {
    if (p.user_id && hiddenIds.has(p.user_id) && p.user_id !== viewerId) return false;
    if (p.original?.user_id && hiddenIds.has(p.original.user_id) && p.original.user_id !== viewerId) {
      return false;
    }
    return true;
  });
}

/** Cascade-delete a user and their auth record. Idempotent-safe for cron retries. */
export async function permanentlyDeleteUser(userId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    // Capture identity before wipe so we can free pending signup holds on the same username/email.
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .maybeSingle();
    let email: string | null = null;
    try {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
      email = authUser?.user?.email ?? null;
    } catch {
      email = null;
    }

    // Mark any open deletion row as done first so retries don't double-process visibly.
    await supabaseAdmin
      .from("account_deletion_requests")
      .update({ status: "done", processed_at: new Date().toISOString() })
      .eq("user_id", userId)
      .in("status", ["suspended", "pending", "approved"]);

    // Child rows first (order matters when FKs lack ON DELETE CASCADE).
    await Promise.allSettled([
      supabaseAdmin.from("notifications").delete().eq("user_id", userId),
      supabaseAdmin.from("notifications").delete().eq("from_user_id", userId),
      supabaseAdmin.from("user_blocks").delete().or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
      supabaseAdmin.from("blocks").delete().or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
      supabaseAdmin.from("friendships").delete().or(`requester_id.eq.${userId},receiver_id.eq.${userId}`),
      supabaseAdmin.from("close_friends").delete().or(`user_id.eq.${userId},friend_id.eq.${userId}`),
      supabaseAdmin.from("close_friends").delete().or(`owner_id.eq.${userId},friend_id.eq.${userId}`),
      supabaseAdmin.from("reactions").delete().eq("user_id", userId),
      supabaseAdmin.from("comments").delete().eq("user_id", userId),
      supabaseAdmin.from("saved_posts").delete().eq("user_id", userId),
      supabaseAdmin.from("mentions").delete().eq("mentioned_user_id", userId),
      supabaseAdmin.from("mentions").delete().eq("user_id", userId),
      supabaseAdmin.from("post_views").delete().eq("user_id", userId),
      supabaseAdmin.from("post_shares").delete().eq("user_id", userId),
      supabaseAdmin.from("user_devices").delete().eq("user_id", userId),
      supabaseAdmin.from("posts").delete().eq("user_id", userId),
      supabaseAdmin.from("conversation_participants").delete().eq("user_id", userId),
      supabaseAdmin.from("messages").delete().eq("sender_id", userId),
      supabaseAdmin.from("reports").delete().eq("reporter_user_id", userId),
      supabaseAdmin.from("reports").delete().eq("reported_user_id", userId),
      supabaseAdmin.from("account_deletion_requests").delete().eq("user_id", userId),
    ]);

    // Free the username/email for new signups only after permanent purge.
    const username = (profile?.username ?? "").toLowerCase().trim();
    if (username) {
      await supabaseAdmin.from("pending_registrations").delete().ilike("username", username);
    }
    if (email) {
      await supabaseAdmin.from("pending_registrations").delete().eq("email", email.toLowerCase().trim());
    }

    const { error: profileDeleteError } = await supabaseAdmin.from("profiles").delete().eq("id", userId);
    if (profileDeleteError) {
      console.error("[account-deletion] profile delete failed:", profileDeleteError.message);
      return { ok: false, error: profileDeleteError.message };
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      // Auth user may already be gone on retry.
      if (!/not found|does not exist/i.test(error.message ?? "")) {
        return { ok: false, error: error.message };
      }
    }
    invalidateDeletionHiddenUserIdsCache();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Immediately suspend the account for deletion (user-facing: "deleted").
 * Content is hidden from others; username stays reserved for the full 30 days.
 * Sends the initial instructions email.
 */
export async function suspendAccountForDeletion(
  userId: string,
  reason?: string | null
): Promise<{ ok: true } | { ok: false; message: string }> {
  const now = new Date().toISOString();

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, username, status, suspended_reason, suspended_at")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) return { ok: false, message: "Profile not found" };

  // Prevent duplicate suspension / deletion in flight.
  if (
    profile.status === "suspended" &&
    profile.suspended_reason === DELETION_SUSPEND_REASON &&
    profile.suspended_at &&
    !shouldPurgeDeletionAccount(profile.suspended_at)
  ) {
    return { ok: true };
  }

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({
      status: "suspended",
      suspended_at: now,
      suspended_reason: DELETION_SUSPEND_REASON,
    })
    .eq("id", userId);

  if (profileError) {
    console.error("[account-deletion] suspend profile failed:", profileError.message);
    return { ok: false, message: "Failed to suspend account" };
  }
  invalidateDeletionHiddenUserIdsCache();

  // Upsert deletion request — status "suspended" (grace window; username still held).
  const { data: existing } = await supabaseAdmin
    .from("account_deletion_requests")
    .select("id")
    .eq("user_id", userId)
    .in("status", ["suspended", "pending"])
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from("account_deletion_requests")
      .update({
        status: "suspended",
        reason: reason ?? null,
        processed_at: null,
        reminder_sent_at: null,
      })
      .eq("id", existing.id);
  } else {
    await supabaseAdmin.from("account_deletion_requests").insert({
      user_id: userId,
      reason: reason ?? null,
      status: "suspended",
      reminder_sent_at: null,
    });
  }

  // Clear push tokens so no notifications after "deletion".
  await supabaseAdmin.from("profiles").update({ push_token: null }).eq("id", userId);
  const { deactivateUserDevices } = await import("./push");
  await deactivateUserDevices(supabaseAdmin, userId);

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  const email = authUser?.user?.email;
  if (email) {
    await sendAccountDeletionEmail(email, profile.full_name ?? "", profile.username ?? "");
  }

  return { ok: true };
}

/** Reactivate a suspended-for-deletion account when the user signs in within the grace window. */
export async function reactivateDeletionSuspendedAccount(userId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      status: "active",
      suspended_at: null,
      suspended_reason: null,
    })
    .eq("id", userId);

  if (error) {
    console.error("[account-deletion] reactivate failed:", error.message);
    return false;
  }
  invalidateDeletionHiddenUserIdsCache();

  await supabaseAdmin
    .from("account_deletion_requests")
    .update({
      status: "cancelled",
      processed_at: new Date().toISOString(),
      admin_note: "User signed in within grace period — account reactivated",
    })
    .eq("user_id", userId)
    .eq("status", "suspended");

  return true;
}

/**
 * Cron: day-29 reminder that permanent deletion (data + username) is imminent.
 * Idempotent via reminder_sent_at on the deletion request row.
 */
export async function sendPendingDeletionReminders(): Promise<number> {
  const { data: rows, error } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, username, suspended_at")
    .eq("status", "suspended")
    .eq("suspended_reason", DELETION_SUSPEND_REASON);

  if (error || !rows?.length) return 0;

  let sent = 0;
  for (const row of rows) {
    if (!shouldSendDeletionReminder(row.suspended_at)) continue;

    const { data: reqRow } = await supabaseAdmin
      .from("account_deletion_requests")
      .select("id, reminder_sent_at")
      .eq("user_id", row.id)
      .eq("status", "suspended")
      .maybeSingle();

    if (reqRow?.reminder_sent_at) continue;

    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(row.id);
    const email = authUser?.user?.email;
    if (!email) continue;

    await sendAccountDeletionReminderEmail(email, row.full_name ?? "", row.username ?? "");

    if (reqRow?.id) {
      await supabaseAdmin
        .from("account_deletion_requests")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", reqRow.id);
    } else {
      await supabaseAdmin.from("account_deletion_requests").insert({
        user_id: row.id,
        status: "suspended",
        reminder_sent_at: new Date().toISOString(),
      });
    }
    sent++;
    console.log(`[account-deletion] Day-29 reminder sent to user ${row.id}`);
  }
  return sent;
}

/** Cron: permanently delete accounts suspended for deletion past the purge window. */
export async function purgeExpiredDeletionAccounts(): Promise<number> {
  const { data: rows, error } = await supabaseAdmin
    .from("profiles")
    .select("id, suspended_at")
    .eq("status", "suspended")
    .eq("suspended_reason", DELETION_SUSPEND_REASON);

  if (error || !rows?.length) return 0;

  let purged = 0;
  for (const row of rows) {
    if (!shouldPurgeDeletionAccount(row.suspended_at)) continue;
    const result = await permanentlyDeleteUser(row.id);
    if (result.ok) {
      purged++;
      console.log(`[account-deletion] Purged user ${row.id}`);
    } else {
      console.error(`[account-deletion] Purge failed for ${row.id}:`, result.error);
    }
  }
  return purged;
}
