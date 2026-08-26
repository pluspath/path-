import { supabaseAdmin } from "../supabase";
import { sendAccountDeletionEmail } from "./email-service";

export const DELETION_SUSPEND_REASON = "account_deletion";
/** User may log in and cancel deletion within this window (days). */
export const DELETION_GRACE_DAYS = 30;
/** Permanent purge runs after grace + 1 day (server-side cron). */
export const DELETION_PURGE_AFTER_DAYS = DELETION_GRACE_DAYS + 1;

const MS_PER_DAY = 86_400_000;

export function daysSince(iso: string | null | undefined): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / MS_PER_DAY;
}

export function isDeletionGracePeriod(suspendedAt: string | null | undefined): boolean {
  return daysSince(suspendedAt) <= DELETION_GRACE_DAYS;
}

export function shouldPurgeDeletionAccount(suspendedAt: string | null | undefined): boolean {
  return daysSince(suspendedAt) >= DELETION_PURGE_AFTER_DAYS;
}

async function sendSuspensionEmail(email: string, fullName: string): Promise<void> {
  await sendAccountDeletionEmail(email, fullName);
}

/** Cascade-delete a user and their auth record. Idempotent-safe for cron retries. */
export async function permanentlyDeleteUser(userId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    // Mark any open deletion row as done first so retries don't double-process visibly.
    await supabaseAdmin
      .from("account_deletion_requests")
      .update({ status: "done", processed_at: new Date().toISOString() })
      .eq("user_id", userId)
      .in("status", ["suspended", "pending", "approved"]);

    await Promise.allSettled([
      supabaseAdmin.from("notifications").delete().eq("user_id", userId),
      supabaseAdmin.from("notifications").delete().eq("from_user_id", userId),
      supabaseAdmin.from("user_blocks").delete().or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
      supabaseAdmin.from("friendships").delete().or(`requester_id.eq.${userId},receiver_id.eq.${userId}`),
      supabaseAdmin.from("close_friends").delete().or(`user_id.eq.${userId},friend_id.eq.${userId}`),
      supabaseAdmin.from("close_friends").delete().or(`owner_id.eq.${userId},friend_id.eq.${userId}`),
      supabaseAdmin.from("reactions").delete().eq("user_id", userId),
      supabaseAdmin.from("comments").delete().eq("user_id", userId),
      supabaseAdmin.from("saved_posts").delete().eq("user_id", userId),
      supabaseAdmin.from("posts").delete().eq("user_id", userId),
      supabaseAdmin.from("conversation_participants").delete().eq("user_id", userId),
      supabaseAdmin.from("messages").delete().eq("sender_id", userId),
      supabaseAdmin.from("reports").delete().eq("reporter_user_id", userId),
      supabaseAdmin.from("account_deletion_requests").delete().eq("user_id", userId),
      supabaseAdmin.from("profiles").delete().eq("id", userId),
    ]);

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      // Auth user may already be gone on retry.
      if (!/not found|does not exist/i.test(error.message ?? "")) {
        return { ok: false, error: error.message };
      }
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Immediately suspend the account for deletion (user-facing: "deleted").
 * Sends suspension email and records the deletion request row.
 */
export async function suspendAccountForDeletion(
  userId: string,
  reason?: string | null
): Promise<{ ok: true } | { ok: false; message: string }> {
  const now = new Date().toISOString();

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, status, suspended_reason, suspended_at")
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

  // Upsert deletion request — status "suspended" (not pending admin approval).
  const { data: existing } = await supabaseAdmin
    .from("account_deletion_requests")
    .select("id")
    .eq("user_id", userId)
    .in("status", ["suspended", "pending"])
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from("account_deletion_requests")
      .update({ status: "suspended", reason: reason ?? null, processed_at: null })
      .eq("id", existing.id);
  } else {
    await supabaseAdmin.from("account_deletion_requests").insert({
      user_id: userId,
      reason: reason ?? null,
      status: "suspended",
    });
  }

  // Clear push token so no notifications after "deletion".
  await supabaseAdmin.from("profiles").update({ push_token: null }).eq("id", userId);

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  const email = authUser?.user?.email;
  if (email) {
    await sendSuspensionEmail(email, profile.full_name ?? "");
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
