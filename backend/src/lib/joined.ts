import { supabaseAdmin } from "../supabase";

// The "Joined Path+" system moment is a special post (type = "joined") that is
// the OLDEST item on every user's timeline. It is created automatically on
// signup and backfilled for existing users. It is never editable or deletable.
export const JOINED_TYPE = "joined";

// Insert a "Joined Path+" post for a single user, idempotently.
// Running this twice for the same user will NOT create a duplicate.
export async function ensureJoinedPost(userId: string, joinedAt?: string | null): Promise<void> {
  try {
    const { data: existing } = await supabaseAdmin
      .from("posts")
      .select("id")
      .eq("user_id", userId)
      .eq("type", JOINED_TYPE)
      .limit(1)
      .maybeSingle();

    if (existing) return; // already has a Joined Path+ moment

    const row: Record<string, unknown> = { user_id: userId, type: JOINED_TYPE };
    if (joinedAt) row.created_at = joinedAt; // timestamp to the join date

    const { error } = await supabaseAdmin.from("posts").insert(row);
    if (error) console.error("[joined] failed to insert joined post:", error.message);
  } catch (e) {
    console.error("[joined] ensureJoinedPost error:", e);
  }
}

// One-time, idempotent backfill: give every existing profile a "Joined Path+"
// moment (timestamped to their profile created_at) if they don't already have
// one. Safe to run repeatedly — it only inserts for users who are missing it.
export async function backfillJoinedPosts(): Promise<{ created: number }> {
  try {
    const { data: profiles, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, created_at");
    if (profErr || !profiles) {
      console.error("[joined] backfill: failed to load profiles:", profErr?.message);
      return { created: 0 };
    }

    const { data: existing, error: postErr } = await supabaseAdmin
      .from("posts")
      .select("user_id")
      .eq("type", JOINED_TYPE);
    if (postErr) {
      console.error("[joined] backfill: failed to load joined posts:", postErr.message);
      return { created: 0 };
    }

    const haveJoined = new Set((existing ?? []).map((p: any) => p.user_id));
    const rows = profiles
      .filter((p: any) => !haveJoined.has(p.id))
      .map((p: any) => ({
        user_id: p.id,
        type: JOINED_TYPE,
        created_at: p.created_at ?? undefined,
      }));

    if (rows.length === 0) return { created: 0 };

    const { error: insertErr } = await supabaseAdmin.from("posts").insert(rows);
    if (insertErr) {
      console.error("[joined] backfill: insert failed:", insertErr.message);
      return { created: 0 };
    }

    console.log(`[joined] backfill: created ${rows.length} Joined Path+ moments`);
    return { created: rows.length };
  } catch (e) {
    console.error("[joined] backfillJoinedPosts error:", e);
    return { created: 0 };
  }
}
