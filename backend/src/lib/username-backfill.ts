import { supabaseAdmin } from "../supabase";

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

function slugFromName(name: string | null | undefined): string {
  const base = String(name ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (base.length >= 3) return base.slice(0, 30);
  return "";
}

function shortIdSlug(id: string): string {
  return `user_${id.replace(/-/g, "").slice(0, 12)}`;
}

async function isUsernameTaken(username: string, exceptUserId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .neq("id", exceptUserId)
    .maybeSingle();
  return !!data;
}

async function pickUniqueUsername(
  userId: string,
  candidates: string[]
): Promise<string> {
  const seen = new Set<string>();
  for (const raw of candidates) {
    let base = String(raw ?? "")
      .toLowerCase()
      .trim()
      .replace(/^@+/, "")
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (base.length < 3) continue;
    base = base.slice(0, 30);
    if (!USERNAME_RE.test(base)) continue;
    if (seen.has(base)) continue;
    seen.add(base);
    if (!(await isUsernameTaken(base, userId))) return base;

    // Numeric suffixes when the preferred handle is already claimed.
    for (let n = 1; n <= 99; n += 1) {
      const suffix = String(n);
      const candidate = `${base.slice(0, Math.max(3, 30 - suffix.length))}${suffix}`;
      if (!USERNAME_RE.test(candidate) || seen.has(candidate)) continue;
      seen.add(candidate);
      if (!(await isUsernameTaken(candidate, userId))) return candidate;
    }
  }

  // Guaranteed unique fallback from the user id.
  let fallback = shortIdSlug(userId);
  if (await isUsernameTaken(fallback, userId)) {
    fallback = `u_${userId.replace(/-/g, "").slice(0, 14)}`;
  }
  return fallback.slice(0, 30);
}

async function healOneProfile(p: {
  id: string;
  username?: string | null;
  full_name?: string | null;
}): Promise<"updated" | "skipped" | "failed"> {
  const existing = String(p.username ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "");
  if (existing && USERNAME_RE.test(existing)) return "skipped";

  let metaUsername = "";
  let metaName = "";
  try {
    const { data: authData } = await supabaseAdmin.auth.admin.getUserById(p.id);
    const meta = authData?.user?.user_metadata ?? {};
    metaUsername = String(meta.username ?? "").trim();
    metaName = String(meta.full_name ?? meta.name ?? "").trim();
  } catch (e) {
    console.warn(
      `[username] backfill: auth lookup failed for ${p.id}:`,
      e instanceof Error ? e.message : e
    );
  }

  const fullName = String(p.full_name ?? "").trim() || metaName;
  const nextUsername = await pickUniqueUsername(p.id, [
    metaUsername,
    slugFromName(fullName),
    shortIdSlug(p.id),
  ]);

  const patch: Record<string, unknown> = { username: nextUsername };
  if (!String(p.full_name ?? "").trim() && fullName) {
    patch.full_name = fullName;
  }

  const { error: updErr } = await supabaseAdmin.from("profiles").update(patch).eq("id", p.id);
  if (updErr) {
    console.error(`[username] backfill update failed for ${p.id}:`, updErr.message);
    return "failed";
  }
  console.log(
    `[username] backfill: ${p.id} → @${nextUsername}` +
      (existing ? ` (replaced invalid "${existing}")` : "")
  );
  return "updated";
}

/** Heal a single profile if username is missing/invalid. */
export async function ensureUserHasUsername(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, username, full_name")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  await healOneProfile(data);
  const { data: refreshed } = await supabaseAdmin
    .from("profiles")
    .select("username")
    .eq("id", userId)
    .maybeSingle();
  return refreshed?.username ?? null;
}

/**
 * Ensure every profile row has a unique, valid username.
 * Never overwrites an existing valid username.
 * Prefers auth metadata / display name; falls back to a unique slug.
 */
export async function backfillMissingUsernames(): Promise<{
  updated: number;
  skipped: number;
}> {
  try {
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, username, full_name");

    if (error || !profiles) {
      console.error("[username] backfill: failed to load profiles:", error?.message);
      return { updated: 0, skipped: 0 };
    }

    let updated = 0;
    let skipped = 0;

    for (const p of profiles) {
      const result = await healOneProfile(p);
      if (result === "updated") updated += 1;
      else if (result === "skipped") skipped += 1;
    }

    console.log(`[username] backfill: updated ${updated}; skipped ${skipped} with valid usernames`);
    return { updated, skipped };
  } catch (e) {
    console.error("[username] backfillMissingUsernames error:", e);
    return { updated: 0, skipped: 0 };
  }
}
